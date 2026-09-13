$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
public static class DshIconCleanup {
  public static void Run(string source,string destination) {
    using(var input=new Bitmap(source))
    using(var output=new Bitmap(input.Width,input.Height,PixelFormat.Format32bppArgb)) {
      int kept=0;
      // The approved tile has a convex navy perimeter. Locate its two edges
      // on each scanline; copy every interior pixel verbatim, including whites.
      for(int y=0;y<input.Height;y++) {
        int left=-1,right=-1;
        for(int x=0;x<input.Width;x++) {
          var c=input.GetPixel(x,y);
          if(c.R<65 && c.G<115 && c.B>c.R+40 && c.B>c.G+20) {
            if(left<0)left=x;right=x;
          }
        }
        if(left<0)continue;
        for(int x=left;x<=right;x++){output.SetPixel(x,y,input.GetPixel(x,y));kept++;}
      }
      if(kept<input.Width*input.Height*0.65 || kept>input.Width*input.Height*0.95)
        throw new Exception("Unexpected tile coverage; refusing to save");
      if(output.GetPixel(0,0).A!=0)throw new Exception("Exterior must be transparent");
      output.Save(destination,ImageFormat.Png);
      Console.WriteLine("Transparent exterior; original interior pixels preserved: "+kept);
    }
  }
}
'@
$branding=Join-Path $PSScriptRoot '..\assets\branding'
[DshIconCleanup]::Run((Join-Path $branding 'dsh-orca-core-v6.png'),(Join-Path $branding 'dsh-app-icon.png'))
