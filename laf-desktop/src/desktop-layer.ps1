param([long]$WindowHandle)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -ReferencedAssemblies System.Windows.Forms -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class LafDesktopLayer {
 public delegate void WinEventProc(IntPtr hook,uint evt,IntPtr h,int obj,int child,uint thread,uint time);
 [DllImport("user32.dll")] public static extern IntPtr SetWinEventHook(uint min,uint max,IntPtr module,WinEventProc callback,uint process,uint thread,uint flags);
 [DllImport("user32.dll")] public static extern bool UnhookWinEvent(IntPtr hook);
 [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h,int index);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder b, int n);
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int command);
 [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int height, uint flags);
 private static IntPtr widget,hook;
 private static volatile bool enabled,closing;
 private static bool desktopShown;
 private static IntPtr lastForeground;
 private static long peerHandle;
 private static bool positioned,previousDesktop;
 public static bool Running { get { return !closing; } }
 private static WinEventProc callback = delegate(IntPtr hookId,uint evt,IntPtr h,int obj,int child,uint thread,uint time) { Maintain(); };
 public static void Start(IntPtr h) {
  widget=h;hook=SetWinEventHook(3,3,IntPtr.Zero,callback,0,0,0);
  if(hook==IntPtr.Zero)throw new System.ComponentModel.Win32Exception();
  var inputThread=new System.Threading.Thread(delegate() {
   string command;
   while((command=Console.ReadLine())!=null && command!="quit") {
    if(command.StartsWith("peer:")){long peer; if(long.TryParse(command.Substring(5),out peer))System.Threading.Interlocked.Exchange(ref peerHandle,peer);}
    else enabled=command=="desktop";
   }
   closing=true;
  });
  inputThread.IsBackground=true;inputThread.Start();
 }
 public static void Enable(bool value) { enabled=value; }
 public static void Pump() { System.Windows.Forms.Application.DoEvents(); Maintain(); }
 public static void Stop() { if(hook!=IntPtr.Zero)UnhookWinEvent(hook); }
 private static void Maintain() {
  if(!enabled || !IsWindow(widget) || !IsWindowVisible(widget)){positioned=false;return;}
  var foreground=GetForegroundWindow();
  if(foreground==IntPtr.Zero)return;
  // Show Desktop raises the shell above normal windows, even without minimizing them.
  // Use the foreground event to stay above the shell only while the desktop is shown.
  var peer=new IntPtr(System.Threading.Interlocked.Read(ref peerHandle));
  if(foreground!=widget && foreground!=peer)desktopShown=DesktopForeground();
  bool restored=false;
  if(desktopShown && IsIconic(widget)){ShowWindow(widget,4);restored=true;}
  bool peerVisible=IsWindow(peer) && IsWindowVisible(peer);
  if(desktopShown && peerVisible && IsIconic(peer)){ShowWindow(peer,4);restored=true;}
  bool topmost=(GetWindowLong(widget,-20)&8)!=0;
  bool peerMatches=!peerVisible || ((GetWindowLong(peer,-20)&8)!=0)==desktopShown;
  // Chromium's show/restore can reset z-order without changing the foreground.
  if(positioned && !restored && lastForeground==foreground && previousDesktop==desktopShown && topmost==desktopShown && peerMatches)return;
  lastForeground=foreground;previousDesktop=desktopShown;positioned=true;
  if(desktopShown) {
   SetWindowPos(widget,new IntPtr(-1),0,0,0,0,0x13);
   if(peerVisible)SetWindowPos(peer,new IntPtr(-1),0,0,0,0,0x13);
  } else if(foreground!=widget) {
   SetWindowPos(widget,new IntPtr(1),0,0,0,0,0x13);
   if(peerVisible)SetWindowPos(peer,new IntPtr(1),0,0,0,0,0x13);
  }
 }
 public static bool DesktopForeground() {
  var name=new StringBuilder(256); GetClassName(GetForegroundWindow(),name,name.Capacity);
  return name.ToString()=="Progman" || name.ToString()=="WorkerW";
 }
}
'@
$widgetHandle = [IntPtr]$WindowHandle
[LafDesktopLayer]::Start($widgetHandle)
while ([LafDesktopLayer]::Running -and [LafDesktopLayer]::IsWindow($widgetHandle)) {
 [LafDesktopLayer]::Pump()
 Start-Sleep -Milliseconds 50
}
[LafDesktopLayer]::Stop()
