import {SceneObject} from "../sceneObject/sceneObject.ts";
import {BaseLayer} from "../../layers/baseLayer.ts";
import {LodSelection} from "./LODSelection/lodSelection.ts";
import {IndirectDraw, LargeBuffer} from "./IndirectDraw/IndirectDraw.ts";
import {createGPUBuffer, updateBuffer} from "../../helpers/global.helper.ts";


export class ComputeManager extends BaseLayer{
    static _isComputeManagerInitialized: boolean = false;
    // buffers
    private static _indexBuffer: LargeBuffer
    private static _indirectBuffer: LargeBuffer
    static cameraPositionBuffer: GPUBuffer;

    static lodSelection: LodSelection;
    static indirectDraw: IndirectDraw;

    constructor(device: GPUDevice, canvas: HTMLCanvasElement, ctx: GPUCanvasContext) {
        super(device, canvas, ctx);

        if (!ComputeManager._isComputeManagerInitialized) {
            this.initComputeManager(device, canvas, ctx)
        }
    }

    public set setIndexBuffer(indexBuffer: LargeBuffer) {
        ComputeManager._indexBuffer = indexBuffer;
    }

    public set setIndirectBuffer(indirectBuffer: LargeBuffer) {
        ComputeManager._indirectBuffer = indirectBuffer;
    }

    public get indexBuffer() {
        return ComputeManager._indexBuffer
    }

    public get indirectBuffer() {
        return ComputeManager._indirectBuffer
    }

    private initComputeManager(device: GPUDevice, canvas: HTMLCanvasElement, ctx: GPUCanvasContext): void {
        ComputeManager.indirectDraw = new IndirectDraw(device, canvas, ctx);
        ComputeManager.lodSelection = new LodSelection(device, canvas, ctx);
        ComputeManager.renderLoopRunAble.set("IndirectDraw", ComputeManager.indirectDraw.renderLoop);
        ComputeManager.renderLoopRunAble.set("LOD", ComputeManager.lodSelection.renderLoop);
        ComputeManager.renderLoopRunAble.set("ComputeManager", this.renderLoop);
        const cameraPosition = BaseLayer.getCameraPosition();

        ComputeManager.cameraPositionBuffer = createGPUBuffer(device, new Float32Array(cameraPosition), GPUBufferUsage.UNIFORM, "global camera psotion buffer");

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
}