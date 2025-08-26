import {BaseLayer} from "./baseLayer.ts";
// @ts-ignore
import lodShader from "../shaders/builtin/lod.wgsl?raw"
import {mat4, vec3} from "gl-matrix";
import {Primitive} from "../engine/primitive/Primitive.ts";
import {renderDownsampleMip} from "../helpers/global.helper.ts";


export class RenderLayer extends BaseLayer {

    constructor(device: GPUDevice, canvas: HTMLCanvasElement, ctx: GPUCanvasContext) {
        super(device, canvas, ctx);
    }

    private buildRenderQueue(viewMatrix: mat4) {
        const opaque: Primitive[] = [];
        const noneTransmissionOpaque: Primitive[] = [];
        const transparentWithDepth: { primitive: Primitive; depth: number }[] = [];

        for (const primitive of RenderLayer.activeScene.drawCalls()) {
            if (primitive.sides.length === 0) continue;
            if (!RenderLayer.activeScene.transmissionPrimitives.has(primitive)) {
                noneTransmissionOpaque.push(primitive);
            }
            if (primitive.material.isTransparent) {
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
        RenderLayer.activeScene.renderQueue = {
            queue: finalQueue,
            noneTransmissionOpaque: noneTransmissionOpaque,
        };

    }


    private checkForUpdate() {

        BaseLayer.activeScene._sceneObjectUpdateQueue.forEach(sceneObject => {
            if (sceneObject.needsUpdate) {
                sceneObject.updateWorldMatrix(RenderLayer.device)
            }
        })


        RenderLayer.pipelineUpdateQueue.forEach(prim => {
            BaseLayer.gpuCache.changePipeline(prim);
        })

        BaseLayer.materialUpdateQueue.clear()
        RenderLayer.pipelineUpdateQueue.clear()
        RenderLayer.activeScene._sceneObjectUpdateQueue.clear()
    }


    public render(commandEncoder: GPUCommandEncoder) {
        // animations
        this.checkForUpdate()

        const sceneActiveCamera = RenderLayer.activeScene.getActiveCamera()
        const viewMatrix = sceneActiveCamera.getViewMatrix();
        this.buildRenderQueue(viewMatrix);
        const primitives: Primitive[] = RenderLayer.activeScene.renderQueue.queue

        if (BaseLayer.transmissionPrimitives.size > 0) {
            const mipLevels = Math.floor(Math.log2(Math.max(window.innerWidth, window.innerHeight))) + 1;

            BaseLayer.activeScene.currentBindGroup = "opaqueOnly"
            const opaqueOnlyPrims: Primitive[] = RenderLayer.activeScene.renderQueue.noneTransmissionOpaque
            BaseLayer.activeScene.usedGlobalBindGroup = BaseLayer.activeScene.dummyGlobalBindGroup;
            RenderLayer.activeScene.update(
                commandEncoder,
                opaqueOnlyPrims,
                BaseLayer.sceneOpaqueTexture!.createView({ baseMipLevel: 0, mipLevelCount: 1 }),
                BaseLayer.sceneOpaqueDepthTexture!.createView({ baseMipLevel: 0, mipLevelCount: 1 }),
                "opaque pass"
            );

            for (let i = 1; i < mipLevels; i++) {
                // render quad
                renderDownsampleMip(
                    BaseLayer.device,commandEncoder,
                    {
                        pipeline:BaseLayer.downSamplePipeline,
                        sampler: BaseLayer.samplers.linear,
                        uniformBuffer:BaseLayer.downSampleUniformBuffer
                    },
                    BaseLayer.sceneOpaqueTexture!.createView({ baseMipLevel: i - 1, mipLevelCount: 1 }),
                    BaseLayer.sceneOpaqueTexture!.createView({ baseMipLevel: i, mipLevelCount: 1 }),
                    false
                );
            }

        }

        BaseLayer.activeScene.currentBindGroup = "main"
        BaseLayer.activeScene.usedGlobalBindGroup = BaseLayer.activeScene.globalBindGroup;
        RenderLayer.activeScene.update(commandEncoder, primitives, this.ctx.getCurrentTexture().createView(), BaseLayer.depthTexture.createView(), "main pass")
    }
}