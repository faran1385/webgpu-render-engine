import {BaseLayer, RenderAble} from "./baseLayer.ts";
// @ts-ignore
import lodShader from "../shaders/builtin/lod.wgsl?raw"
import {mat4, vec3} from "gl-matrix";


export class MainLayer extends BaseLayer {

    constructor(device: GPUDevice, canvas: HTMLCanvasElement, ctx: GPUCanvasContext) {
        super(device, canvas, ctx);
    }

    private buildRenderQueue(viewMatrix: mat4): RenderAble[] {

        const out: RenderAble[] = [];
        const queues = BaseLayer.drawCalls;
        // 1) OPAQUE: no sorting needed
        out.push(...queues.opaque);

        // 2) TRANSPARENT: compute depth in view space for each entry
        const withDepth = queues.transparent.map(r => {
            const m = r.renderData.model.data;
            // extract world position (translation) from model matrix
            const worldPos: [number, number, number] = [m[12], m[13], m[14]];
            // transform into view space
            const viewPos = vec3.transformMat4(vec3.create(), worldPos, viewMatrix);
            // use -Z (more negative Z in view = farther)
            const depth = -viewPos[2];
            return {r, depth};
        });

        // 3) Sort transparent entries back-to-front
        withDepth.sort((a, b) => b.depth - a.depth);

        // 4) Append sorted transparent entries
        out.push(...withDepth.map(item => item.r));
        MainLayer.renderQueue = {
            queue: out,
            needsUpdate: false
        }
        return out;
    }

    private checkForUpdate() {
        BaseLayer._updateQueue.forEach(sceneObject => {
            if (sceneObject.needsUpdate) {
                sceneObject.updateWorldMatrix(MainLayer.device)
            }
        })
        BaseLayer._updateQueue.clear()
    }


    public render(commandEncoder: GPUCommandEncoder) {
        this.checkForUpdate()
        const {viewMatrix} = this.getCameraVP()
        const renderAbleArray: RenderAble[] = BaseLayer.renderQueue.needsUpdate ? this.buildRenderQueue(viewMatrix) : BaseLayer.renderQueue.queue

        const lodRunAble = MainLayer.renderLoopRunAble.get("LOD")
        if (lodRunAble) lodRunAble(commandEncoder);
        const pass = commandEncoder.beginRenderPass({
            label: "main pass",
            depthStencilAttachment: {
                view: MainLayer.depthTexture.createView(),
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
        const indirectDrawRunAble = MainLayer.renderLoopRunAble.get("IndirectDraw")
        const computeManagerRunAble = MainLayer.renderLoopRunAble.get("ComputeManager")
        if (computeManagerRunAble) computeManagerRunAble(viewMatrix);
        if (indirectDrawRunAble) indirectDrawRunAble(renderAbleArray, pass)
        pass.end()
    }
}