import {BaseLayer} from "./baseLayer.ts";
// @ts-ignore
import lodShader from "../shaders/builtin/lod.wgsl?raw"
import {mat4, vec3} from "gl-matrix";
import {GPUCache} from "../scene/GPURenderSystem/GPUCache/GPUCache.ts";
import {Primitive} from "../scene/primitive/Primitive.ts";


export class RenderLayer extends BaseLayer {
    private gpuCache: GPUCache;

    constructor(device: GPUDevice, canvas: HTMLCanvasElement, ctx: GPUCanvasContext, gpuCache: GPUCache) {
        super(device, canvas, ctx);
        this.gpuCache = gpuCache;
    }

    private buildRenderQueue(viewMatrix: mat4): Primitive[] {
        const opaque: Primitive[] = [];
        const transparentWithDepth: { primitive: Primitive; depth: number }[] = [];

        for (const primitive of RenderLayer.drawCalls) {
            if (primitive.side.length === 0) continue;

            if (primitive.isTransparent) {
                const model = primitive.modelMatrix;
                const worldPos: vec3 = [model[12], model[13], model[14]];
                const viewPos = vec3.transformMat4(vec3.create(), worldPos, viewMatrix);
                const depth = -viewPos[2];
                transparentWithDepth.push({primitive, depth});
            } else {
                opaque.push(primitive);
            }
        }

        transparentWithDepth.sort((a, b) => b.depth - a.depth);

        const finalQueue = [...opaque, ...transparentWithDepth.map(d => d.primitive)];

        RenderLayer.renderQueue = {
            queue: finalQueue,
            needsUpdate: false
        };

        return finalQueue;
    }


    private checkForUpdate() {
        BaseLayer._sceneObjectUpdateQueue.forEach(sceneObject => {
            if (sceneObject.needsUpdate) {
                sceneObject.updateWorldMatrix(BaseLayer.device)
            }
        })
        BaseLayer._materialUpdateQueue.forEach(material => {
            this.gpuCache.changeBindGroupEntries(material)
        })
        BaseLayer._sceneObjectUpdateQueue.clear()
        BaseLayer._materialUpdateQueue.clear()
    }


    public render(commandEncoder: GPUCommandEncoder) {
        // animations
        const time = performance.now() / 1000;
        RenderLayer.renderLoopAnimations.forEach((func) => func(time))
        this.checkForUpdate()
        const lightUpdate = RenderLayer.renderLoopRunAble.get("LightUpdate");
        if (lightUpdate) lightUpdate();

        const skinUpdate = RenderLayer.renderLoopRunAble.get("SkinUpdate");
        if (skinUpdate) skinUpdate();
        const {viewMatrix, projectionMatrix} = this.getCameraVP()
        const primitives: Primitive[] = BaseLayer.renderQueue.needsUpdate ? this.buildRenderQueue(viewMatrix) : BaseLayer.renderQueue.queue

        // compute shaders
        const lodRunAble = RenderLayer.renderLoopRunAble.get("LOD")
        const frustumCullingRunAble = RenderLayer.renderLoopRunAble.get("FrustumCulling")
        if (lodRunAble) lodRunAble(commandEncoder);
        if (frustumCullingRunAble) frustumCullingRunAble(commandEncoder, viewMatrix, projectionMatrix);
        // render
        const pass = commandEncoder.beginRenderPass({
            label: "main pass",
            depthStencilAttachment: {
                view: RenderLayer.depthTexture.createView(),
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

        const indirectDrawRunAble = RenderLayer.renderLoopRunAble.get("IndirectDraw")
        const computeManagerRunAble = RenderLayer.renderLoopRunAble.get("ComputeManager")
        if (computeManagerRunAble) computeManagerRunAble(viewMatrix);
        if (indirectDrawRunAble) indirectDrawRunAble(primitives, pass)
        pass.end()
    }
}