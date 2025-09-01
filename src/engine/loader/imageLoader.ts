export class ImageLoader {
    async load(url: string) {
        const response = await fetch(url);
        const blobData = await response.blob()
        const bitmap = await createImageBitmap(blobData);
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(bitmap, 0, 0);
        return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    }
}