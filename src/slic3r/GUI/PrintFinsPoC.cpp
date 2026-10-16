#include "PrintFinsPoC.hpp"
#include "Plater.hpp"
#include "GUI_App.hpp"
#include "GUI_ObjectList.hpp"
#include "Widgets/WebView.hpp"
#include "libslic3r/Model.hpp"
#include "libslic3r/PrintConfig.hpp"
#include "libslic3r/Utils.hpp"
#include "libslic3r/TriangleMeshSlicer.hpp"
#include "libslic3r/Format/3mf.hpp"
#include "libslic3r/Format/STL.hpp"
#include <nlohmann/json.hpp>
#include <boost/filesystem.hpp>
#include <boost/log/trivial.hpp>
#include <fstream>
#include <algorithm>
#include <cmath>
#include <wx/dialog.h>
#include <wx/sizer.h>
#include <wx/stattext.h>
#include <wx/timer.h>
#include <wx/utils.h>
#if defined(_WIN32) && wxUSE_WEBVIEW_EDGE
#include <WebView2.h>
#include <wrl/client.h>
#endif

namespace Slic3r::GUI {
namespace {
using Json = nlohmann::json;
namespace fs = boost::filesystem;

Json posed_mesh(const ModelObject &object)
{
    if (object.instances.size() != 1 || object.volumes.empty())
        throw std::runtime_error("PoC requires exactly one instance and at least one volume");
    if (!object.layer_height_profile.empty())
        throw std::runtime_error("Variable layer height is not supported by this PoC");
    Json positions = Json::array();
    for (const ModelVolume *volume : object.volumes) {
        if (!volume->is_model_part() || volume->name.rfind("PrintFins PoC", 0) == 0)
            throw std::runtime_error("PoC requires plain model parts; modifiers/previous fins are unsupported");
        const Transform3d matrix = object.instances.front()->get_matrix() * volume->get_matrix();
        const auto &its = volume->mesh().its;
        for (const auto &face : its.indices) {
            for (int k = 0; k < 3; ++k) {
                const int corner = matrix.linear().determinant() < 0 && k > 0 ? 3 - k : k;
                const Vec3d p = matrix * its.vertices[face[corner]].cast<double>();
                for (int axis = 0; axis < 3; ++axis) positions.push_back(p[axis]);
            }
        }
    }
    if (positions.empty() || positions.size() > 900000)
        throw std::runtime_error("PoC input limit is 100000 triangles");
    return positions;
}

class PoCDialog final : public wxDialog {
    Plater &m_plater;
    fs::path m_output;
    Json m_request;
    ObjectID m_object_id;
    wxWebView *m_web = nullptr;
    wxStaticText *m_status;
    wxTimer m_timeout;
    bool m_mapped = false;
    bool m_finished = false;

    void finish(Json report)
    {
        if (m_finished) return;
        m_finished = true;
        m_timeout.Stop();
        std::ofstream file((m_output / "report.json").string(), std::ios::binary);
        file << report.dump(2);
        m_status->SetLabel(report.value("ok", false) ? "PrintFins geometry added. Close to inspect the model." :
                           wxString::FromUTF8(report.value("error", "Unknown error")));
        BOOST_LOG_TRIVIAL(info) << "PrintFins PoC: " << report.dump();
        wxString auto_close;
        if (wxGetEnv("BBS_PRINTFINS_POC_AUTOCLOSE", &auto_close) && auto_close == "1")
            CallAfter([this] { EndModal(wxID_OK); });
    }

    void accept(const Json &result)
    {
        if (!result.value("ok", false)) throw std::runtime_error(result.value("error", "Engine failed"));
        auto &model = m_plater.model();
        if (model.objects.size() != 1 || model.objects.front()->id() != m_object_id ||
            posed_mesh(*model.objects.front()) != m_request["positions"])
            throw std::runtime_error("Model changed while computing; result discarded");
        ModelObject &object = *model.objects.front();
        const auto triangles = result.at("triangles").get<std::vector<double>>();
        if (triangles.empty() || triangles.size() % 9 || triangles.size() > 9000000)
            throw std::runtime_error("Engine returned empty or oversized triangle geometry");
        const auto &offset = result.at("offset");
        const Vec3d off(offset.at("x").get<double>(), offset.at("y").get<double>(), offset.at("z").get<double>());
        if (!off.allFinite()) throw std::runtime_error("Non-finite engine offset");
        const Transform3d inverse = object.instances.front()->get_matrix().inverse();
        std::vector<TriangleMesh> meshes;
        std::vector<std::string> names;
        std::vector<bool> used(triangles.size() / 9, false);
        for (const auto &piece : result.at("pieces")) {
            indexed_triangle_set its;
            for (const auto &range : piece.at("ranges")) {
                const size_t begin = range.at(0).get<size_t>(), end = range.at(1).get<size_t>();
                if (begin >= end || end > used.size()) throw std::runtime_error("Invalid piece range");
                for (size_t t = begin; t < end; ++t) {
                    if (used[t]) throw std::runtime_error("Overlapping piece ranges");
                    used[t] = true;
                    const int start = int(its.vertices.size());
                    for (int k = 0; k < 3; ++k) {
                        const size_t i = 9 * t + 3 * k;
                        const Vec3d world(triangles[i], triangles[i + 1], triangles[i + 2]);
                        if (!world.allFinite()) throw std::runtime_error("Non-finite engine vertex");
                        its.vertices.push_back((inverse * (world - off)).cast<float>());
                    }
                    its.indices.emplace_back(start, start + (inverse.linear().determinant() < 0 ? 2 : 1),
                                             start + (inverse.linear().determinant() < 0 ? 1 : 2));
                }
            }
            its_merge_vertices(its);
            meshes.emplace_back(std::move(its));
            names.push_back("PrintFins PoC " + piece.at("kind").get<std::string>() + " " + piece.at("id").get<std::string>());
        }
        if (meshes.empty() || std::find(used.begin(), used.end(), false) != used.end())
            throw std::runtime_error("Engine pieces do not cover the output");
        // Prepare and validate everything before modifying the live model.
        TriangleMesh fin_geometry;
        for (const auto &mesh : meshes) {
            TriangleMesh posed = mesh;
            posed.transform(object.instances.front()->get_matrix(), true);
            fin_geometry.merge(posed);
        }
        const double height = m_request["options"]["layerHeight"].get<double>();
        const double first = m_request["options"]["firstLayerHeight"].get<double>();
        std::vector<float> fin_planes{float(first / 2)};
        for (double z = first + height / 2; z < fin_geometry.bounding_box().max.z(); z += height)
            fin_planes.push_back(float(z));
        const auto fin_slices = slice_mesh(fin_geometry.its, fin_planes, MeshSlicingParams{});
        size_t fin_nonempty = 0;
        for (const auto &layer : fin_slices) if (!layer.empty()) ++fin_nonempty;
        if (!fin_nonempty) throw std::runtime_error("Fin geometry produced no slice contours");
        const size_t original_volumes = object.volumes.size();
        const Transform3d instance_before = object.instances.front()->get_matrix();
        m_plater.take_snapshot("PrintFins engine PoC");
        for (size_t i = 0; i < meshes.size(); ++i) {
            auto *volume = object.add_volume(std::move(meshes[i]), ModelVolumeType::MODEL_PART, false);
            volume->name = names[i];
            volume->calculate_convex_hull();
        }
        object.invalidate_bounding_box();
        wxGetApp().obj_list()->add_volumes_to_object_in_list(0);
        m_plater.changed_object(object);
        // changed_object may re-seat the object; record rather than hide that movement.
        const double instance_shift = (object.instances.front()->get_matrix().matrix() - instance_before.matrix()).norm();
        TriangleMesh combined = object.mesh();
        const auto bbox = combined.bounding_box();
        std::vector<float> planes{float(first / 2)};
        for (double z = first + height / 2; z < bbox.max.z(); z += height) planes.push_back(float(z));
        const auto slices = slice_mesh(combined.its, planes, MeshSlicingParams{});
        size_t nonempty = 0, contours = 0;
        for (const auto &layer : slices) { if (!layer.empty()) ++nonempty; contours += layer.size(); }
        const bool stl = store_stl((m_output / "combined.stl").string().c_str(), &combined, true);
        const bool project = store_3mf((m_output / "result.3mf").string().c_str(), &model, nullptr, false);
        const bool bambu_project = m_plater.export_3mf(m_output / "project.3mf", SaveStrategy::Silence) == 0;
        Json report = {{"ok", stl && project && bambu_project && nonempty > 0}, {"engine", result.at("stats")},
            {"settings", result.at("settings")}, {"input_triangles", m_request["positions"].size() / 9},
            {"output_triangles", triangles.size() / 9}, {"original_volumes", original_volumes},
            {"added_volumes", meshes.size()}, {"total_volumes", object.volumes.size()},
            {"instance_transform_delta", instance_shift}, {"slice_planes", planes.size()},
            {"fin_nonempty_slices", fin_nonempty},
            {"nonempty_slices", nonempty}, {"slice_contours", contours},
            {"exported_stl", stl}, {"exported_3mf", project}, {"exported_bambu_project", bambu_project},
            {"full_toolpath_test", false}};
        if (!report["ok"].get<bool>()) report["error"] = "Geometry was added, but slicing/export validation failed";
        finish(report);
    }

public:
    PoCDialog(Plater &plater, const fs::path &output) :
        wxDialog(&plater, wxID_ANY, "PrintFins engine PoC", wxDefaultPosition, wxSize(550, 220)),
        m_plater(plater), m_output(output), m_timeout(this)
    {
        auto *layout = new wxBoxSizer(wxVERTICAL);
        m_status = new wxStaticText(this, wxID_ANY, "Running the local PrintFins engine...");
        layout->Add(m_status, 0, wxALL | wxEXPAND, 12);
        layout->Add(CreateButtonSizer(wxCLOSE), 0, wxALL | wxALIGN_RIGHT, 12);
        SetSizer(layout);
        Bind(wxEVT_BUTTON, [this](wxCommandEvent &) { EndModal(wxID_CLOSE); }, wxID_CLOSE);
        Bind(wxEVT_TIMER, [this](wxTimerEvent &) { finish({{"ok", false}, {"error", "WebView/engine timed out after 120 seconds"}}); });
        try {
            fs::create_directories(output);
            if (plater.model().objects.size() != 1) throw std::runtime_error("PoC requires exactly one loaded object");
            auto &object = *plater.model().objects.front();
            m_object_id = object.id();
            m_request = {{"positions", posed_mesh(object)}, {"options", Json::object()}};
            wxString options_path;
            if (wxGetEnv("BBS_PRINTFINS_POC_OPTIONS", &options_path)) {
                std::ifstream options(options_path.ToStdString());
                options >> m_request["options"];
            }
            // Read effective heights from the current object / preset; never change presets.
            auto config = *plater.config();
            config.apply(object.config.get());
            m_request["options"]["layerHeight"] = config.option<ConfigOptionFloat>("layer_height")->value;
            m_request["options"]["firstLayerHeight"] = config.option<ConfigOptionFloat>("initial_layer_print_height")->value;
            std::ofstream request((output / "request.json").string(), std::ios::binary);
            request << m_request.dump();
#if defined(_WIN32) && wxUSE_WEBVIEW_EDGE
            m_web = WebView::CreateWebView(this, "about:blank", "PrintFinsPoC");
            m_web->Hide();
            m_web->Bind(wxEVT_WEBVIEW_NAVIGATING, [](wxWebViewEvent &e) {
                if (e.GetURL() != "about:blank" && e.GetURL() != "https://printfins-poc.invalid/poc.html") e.Veto();
            });
            m_web->Bind(wxEVT_WEBVIEW_LOADED, [this](wxWebViewEvent &) {
                if (m_mapped) return;
                try {
                    auto *backend = static_cast<ICoreWebView2 *>(m_web->GetNativeBackend());
                    Microsoft::WRL::ComPtr<ICoreWebView2_3> local;
                    if (!backend || FAILED(backend->QueryInterface(IID_PPV_ARGS(&local))))
                        throw std::runtime_error("WebView2 virtual host mapping is unavailable");
                    wxString assets;
                    if (!wxGetEnv("BBS_PRINTFINS_POC_ASSETS", &assets)) assets = wxString::FromUTF8(resources_dir() + "/printfins");
                    if (FAILED(local->SetVirtualHostNameToFolderMapping(L"printfins-poc.invalid", assets.wc_str(), COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_DENY)))
                        throw std::runtime_error("Cannot map local PrintFins assets");
                    m_mapped = true;
                    m_web->LoadURL("https://printfins-poc.invalid/poc.html");
                } catch (const std::exception &e) { finish({{"ok", false}, {"error", e.what()}}); }
            });
            m_web->Bind(wxEVT_WEBVIEW_SCRIPT_MESSAGE_RECEIVED, [this](wxWebViewEvent &event) {
                if (m_finished) return;
                try {
                    const auto message = Json::parse(event.GetString().ToStdString());
                    if (message.value("ready", false)) {
                        if (!WebView::RunScript(m_web, wxString::FromUTF8("window.startPrintFins(" + m_request.dump() + ");")))
                            throw std::runtime_error("Cannot submit engine request");
                    } else accept(message);
                } catch (const std::exception &e) { finish({{"ok", false}, {"error", e.what()}}); }
            });
            m_web->LoadURL("about:blank");
            m_timeout.StartOnce(120000);
#else
            throw std::runtime_error("This PoC currently requires Windows WebView2");
#endif
        } catch (const std::exception &e) { CallAfter([this, message = std::string(e.what())] { finish({{"ok", false}, {"error", message}}); }); }
    }
};
} // namespace

void run_printfins_poc(Plater &plater)
{
    wxString enabled, output;
    if (!wxGetEnv("BBS_PRINTFINS_POC_ENABLE", &enabled) || enabled != "1") return;
    if (!wxGetEnv("BBS_PRINTFINS_POC_OUTPUT", &output) || output.empty()) return;
    const fs::path destination(output.ToStdWstring());
    try {
        // Only run with the sibling scratch profile prepared by prepare-run.py.
        // An inherited output variable must never activate the PoC in a normal profile.
        const fs::path profile = destination.parent_path() / "profile";
        if (destination.filename() != "result" || fs::exists(destination) ||
            !fs::is_directory(profile) || !fs::equivalent(fs::path(data_dir()), profile)) {
            BOOST_LOG_TRIVIAL(error) << "PrintFins PoC requires a fresh result directory and its sibling test profile";
            return;
        }
    } catch (const std::exception &e) {
        BOOST_LOG_TRIVIAL(error) << "PrintFins PoC startup refused: " << e.what();
        return;
    }
    PoCDialog dialog(plater, destination);
    dialog.ShowModal();
}
} // namespace Slic3r::GUI
