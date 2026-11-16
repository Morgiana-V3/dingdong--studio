import { BrowserWindow } from 'electron'
// macOS nativeImage cannot decode some WebP variants. Use Chromium's image decoder
// in an isolated local document, without network access or page-provided scripts.
export async function compactRaster(
  dataURL: string,
  budget: number,
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted()
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  })
  const combined = AbortSignal.any([AbortSignal.timeout(15000), ...(signal ? [signal] : [])])
  const close = () => {
    if (!win.isDestroyed()) win.destroy()
  }
  combined.addEventListener('abort', close, { once: true })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  try {
    combined.throwIfAborted()
    await win.loadURL(
      'data:text/html,' +
        encodeURIComponent(
          '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; script-src \'none\'">',
        ),
    )
    const result: unknown = await win.webContents.executeJavaScript(`(async()=>{
      const image=new Image();image.src=${JSON.stringify(dataURL)};await image.decode();
      if (!image.naturalWidth || image.naturalWidth*image.naturalHeight>40000000) throw new Error('图片尺寸过大');
      const canvas=document.createElement('canvas');const context=canvas.getContext('2d');
      for(const width of [1200,960,720,480,320,240,160]){
        canvas.width=Math.max(1,Math.floor(Math.min(width,image.naturalWidth,2400*image.naturalWidth/image.naturalHeight)));canvas.height=Math.max(1,Math.round(image.naturalHeight*canvas.width/image.naturalWidth));
        context.fillStyle='#ffffff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);
        for(const quality of [0.82,0.65,0.45,0.30]){
          const url=canvas.toDataURL('image/jpeg',quality);
          if((url.length-url.indexOf(',')-1)*3/4<=${JSON.stringify(budget)})return url;
        }
      }
      throw new Error('图片超过预算');
    })()`)
    if (typeof result !== 'string' || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(result))
      throw new Error('配图转换失败')
    return result
  } catch (error) {
    signal?.throwIfAborted()
    throw new Error('配图转换失败或超过预算', { cause: error })
  } finally {
    combined.removeEventListener('abort', close)
    close()
  }
}
