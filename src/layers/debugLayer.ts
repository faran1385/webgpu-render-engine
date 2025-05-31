import {BaseLayer} from "./baseLayer.ts";


export class DebugLayer extends BaseLayer {
    private static _renderBundles: GPURenderBundle[] = [];

    constructor(device: GPUDevice, canvas: HTMLCanvasElement, ctx: GPUCanvasContext) {
        super(device, canvas, ctx);
    }

    private static get renderBundles(): GPURenderBundle[] {
        return DebugLayer._renderBundles;
    }

    public static set setRenderBundle(item: GPURenderBundle) {
        DebugLayer._renderBundles.push(item);
    }

    render(commandEncoder: GPUCommandEncoder) {
        const pass = commandEncoder.beginRenderPass({
            label: "debug pass",
            depthStencilAttachment: {
                view: DebugLayer.depthTexture.createView(),
                depthStoreOp: "store",
                depthLoadOp: "clear",
                depthClearValue: 1.
            },
            colorAttachments: [{
                view: this.ctx.getCurrentTexture().createView(),
                storeOp: "store",
                loadOp: "load",
            }]
        })
        pass.executeBundles(DebugLayer.renderBundles)
        pass.end()
    }
}