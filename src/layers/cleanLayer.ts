import {BaseLayer} from "./baseLayer.ts";

export class CleanLayer extends BaseLayer {


    constructor(device: GPUDevice, canvas: HTMLCanvasElement, ctx: GPUCanvasContext, clearValue: [number, number, number, number]) {
        super(device, canvas, ctx);
        const commandEncoder = this.device.createCommandEncoder();

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
        this.device.queue.submit([commandEncoder.finish()])
    }

}
