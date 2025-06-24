import {SceneObject} from "../sceneObject/sceneObject.ts";
import {BaseLayer} from "../../layers/baseLayer.ts";
import {LodSelection} from "./LODSelection/lodSelection.ts";
import {IndirectDraw} from "./IndirectDraw/IndirectDraw.ts";
import {createGPUBuffer, updateBuffer} from "../../helpers/global.helper.ts";
import {FrustumCulling} from "./FrustumCulling/frustumCulling.ts";


export class ComputeManager extends BaseLayer {
    static _isComputeManagerInitialized: boolean = false;
    // buffers
    static cameraPositionBuffer: GPUBuffer;

    static lodSelection: LodSelection;
    static indirectDraw: IndirectDraw;
    static frustumCulling: FrustumCulling;

    constructor(device: GPUDevice, canvas: HTMLCanvasElement, ctx: GPUCanvasContext) {
        super(device, canvas, ctx);
        if (!ComputeManager._isComputeManagerInitialized) {
            this.initComputeManager(device, canvas, ctx)
        }
    }


    private initComputeManager(device: GPUDevice, canvas: HTMLCanvasElement, ctx: GPUCanvasContext): void {
        ComputeManager.indirectDraw = new IndirectDraw(device, canvas, ctx);
        ComputeManager.lodSelection = new LodSelection(device, canvas, ctx);
        ComputeManager.frustumCulling = new FrustumCulling(device, canvas, ctx);
        ComputeManager.renderLoopRunAble.set("IndirectDraw", ComputeManager.indirectDraw.renderLoop);
        ComputeManager.renderLoopRunAble.set("LOD", ComputeManager.lodSelection.renderLoop);
        ComputeManager.renderLoopRunAble.set("FrustumCulling", ComputeManager.frustumCulling.renderLoop);
        ComputeManager.renderLoopRunAble.set("ComputeManager", this.renderLoop);
        const cameraPosition = BaseLayer.getCameraPosition();

        ComputeManager.cameraPositionBuffer = createGPUBuffer(device, new Float32Array(cameraPosition), GPUBufferUsage.UNIFORM, "global camera position buffer");

        ComputeManager._isComputeManagerInitialized = true;
    }

    private renderLoop() {
        const cameraPosition = BaseLayer.getCameraPosition();
        updateBuffer(BaseLayer.device, ComputeManager.cameraPositionBuffer, cameraPosition)
    }

    public setIndex(sceneObject: SceneObject) {
        ComputeManager.indirectDraw.appendIndex(sceneObject);
    }

    public setIndirect(sceneObject: SceneObject) {
        ComputeManager.indirectDraw.appendIndirect(sceneObject);
    }

    public setLodSelection(sceneObject: SceneObject) {
        ComputeManager.lodSelection.appendLodSelection(sceneObject);
    }

    public setFrustumCulling(sceneObject: SceneObject) {
        ComputeManager.frustumCulling.appendFrustumCulling(sceneObject);
    }
}