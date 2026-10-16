#ifndef slic3r_GUI_PrintFinsPoC_hpp_
#define slic3r_GUI_PrintFinsPoC_hpp_
namespace Slic3r::GUI {
class Plater;
// Explicit developer opt-in; has no effect without BBS_PRINTFINS_POC_OUTPUT.
void run_printfins_poc(Plater &plater);
}
#endif
