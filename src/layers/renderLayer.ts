import {BaseLayer} from "./baseLayer.ts";
// @ts-ignore
import lodShader from "../shaders/builtin/lod.wgsl?raw"
import {mat4, vec3} from "gl-matrix";
import {Primitive} from "../engine/primitive/Primitive.ts";


export class RenderLayer extends BaseLayer {

    constructor(device: GPUDevice, canvas: HTMLCanvasElement, ctx: GPUCanvasContext) {
        super(device, canvas, ctx);
    }

    private buildRenderQueue(viewMatrix: mat4) {
        const opaque: Primitive[] = [];
        const transparentWithDepth: { primitive: Primitive; depth: number }[] = [];

        for (const primitive of RenderLayer.activeScene.drawCalls()) {
            if (primitive.sides.length === 0) continue;

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
            opaqueOnly: opaque,
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

        RenderLayer.activeScene.update(commandEncoder, primitives, this.ctx.getCurrentTexture().createView(), BaseLayer.depthTexture.createView())
    }
}