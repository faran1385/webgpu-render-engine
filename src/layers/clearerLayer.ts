import {BaseLayer} from "./baseLayer.ts";

export class ClearerLayer extends BaseLayer {


    constructor(device: GPUDevice, canvas: HTMLCanvasElement, ctx: GPUCanvasContext, clearValue: [number, number, number, number]) {
        super(device, canvas, ctx);
        const commandEncoder = device.createCommandEncoder();

        const pass = commandEncoder.beginRenderPass({
            label: "clean pass",
            colorAttachments: [{
                view: this.ctx.getCurrentTexture().createView(),
                storeOp: "store",
                clearValue,
                loadOp: "clear"
            }],
        })
        pass.end()
        device.queue.submit([commandEncoder.finish()])
    }

}
