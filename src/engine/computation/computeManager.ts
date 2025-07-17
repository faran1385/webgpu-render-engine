import {SceneObject} from "../sceneObject/sceneObject.ts";
import {LodSelection} from "./LODSelection/lodSelection.ts";
import {IndirectDraw} from "./IndirectDraw/IndirectDraw.ts";
import {FrustumCulling} from "./FrustumCulling/frustumCulling.ts";
import {Scene} from "../scene/Scene.ts";


export class ComputeManager {
    static _isComputeManagerInitialized: boolean = false;
    // buffers
    lodSelection!: LodSelection;
    indirectDraw!: IndirectDraw;
    frustumCulling!: FrustumCulling;

    constructor(device: GPUDevice, canvas: HTMLCanvasElement, ctx: GPUCanvasContext, scene: Scene) {
        if (!ComputeManager._isComputeManagerInitialized) {
            this.initComputeManager(device, canvas, ctx, scene)
        }
    }


    private initComputeManager(device: GPUDevice, canvas: HTMLCanvasElement, ctx: GPUCanvasContext, scene: Scene) {
        this.indirectDraw = new IndirectDraw(scene);
        this.lodSelection = new LodSelection(scene, device, canvas, ctx);
        this.frustumCulling = new FrustumCulling(scene, device, canvas, ctx);

        ComputeManager._isComputeManagerInitialized = true;
    }


    public setIndex(sceneObject: SceneObject) {
        this.indirectDraw.appendIndex(sceneObject);
    }

    public setIndirect(sceneObject: SceneObject) {
        this.indirectDraw.appendIndirect(sceneObject);
    }

    public setLodSelection(sceneObject: SceneObject) {
        this.lodSelection.appendLodSelection(sceneObject);
    }

    public setFrustumCulling(sceneObject: SceneObject) {

        this.frustumCulling.appendFrustumCulling(sceneObject);
    }
}