import {BaseLayer} from "./baseLayer.ts";
// @ts-ignore
import lodShader from "../shaders/builtin/lod.wgsl?raw"
import {mat4, vec3} from "gl-matrix";
import {GPUCache} from "../engine/GPURenderSystem/GPUCache/GPUCache.ts";
import {Primitive} from "../engine/primitive/Primitive.ts";


export class RenderLayer extends BaseLayer {
    private gpuCache: GPUCache;

    constructor(device: GPUDevice, canvas: HTMLCanvasElement, ctx: GPUCanvasContext, gpuCache: GPUCache) {
        super(device, canvas, ctx);
        this.gpuCache = gpuCache;
    }

    private buildRenderQueue(viewMatrix: mat4): Primitive[] {
        const opaque: Primitive[] = [];
        const transparentWithDepth: { primitive: Primitive; depth: number }[] = [];

        for (const primitive of RenderLayer.activeScene.drawCalls()) {
            if (primitive.sides.length === 0) continue;

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

        RenderLayer.activeScene.renderQueue = {
            queue: finalQueue,
            needsUpdate: false
        };

        return finalQueue;
    }


    private checkForUpdate() {

        BaseLayer.activeScene._sceneObjectUpdateQueue.forEach(sceneObject => {
            if (sceneObject.needsUpdate) {
                sceneObject.updateWorldMatrix(RenderLayer.device)
            }
        })

        RenderLayer.materialUpdateQueue.forEach(mat => {
            this.gpuCache.changeMaterial(mat);
        })

        RenderLayer.activeScene.pipelineUpdateQueue.forEach(prim => {
            this.gpuCache.changePipeline(prim);
        })

        BaseLayer.materialUpdateQueue.clear()
        RenderLayer.activeScene.pipelineUpdateQueue.clear()
        RenderLayer.activeScene._sceneObjectUpdateQueue.clear()
    }


    public render(commandEncoder: GPUCommandEncoder) {
        // animations

        this.checkForUpdate()


        const sceneActiveCamera = RenderLayer.activeScene.getActiveCamera()
        const viewMatrix = sceneActiveCamera.getViewMatrix();

        const primitives: Primitive[] = RenderLayer.activeScene.renderQueue.needsUpdate ?
            this.buildRenderQueue(viewMatrix) :
            RenderLayer.activeScene.renderQueue.queue

        RenderLayer.activeScene.update(commandEncoder, primitives)
    }
}