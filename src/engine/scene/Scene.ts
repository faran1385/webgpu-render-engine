import {BaseLayer} from "../../layers/baseLayer.ts";
import {Camera} from "../camera/Camera.ts";
import {LightManager} from "../lightManager/lightManager.ts";
import {SceneObject} from "../sceneObject/sceneObject.ts";
import {Primitive} from "../primitive/Primitive.ts";
import {SkinManager} from "../skinManager/skinManager.ts";
import {LargeBuffer} from "../computation/IndirectDraw/IndirectDraw.ts";
import {ComputeManager} from "../computation/computeManager.ts";
import {Background} from "../environment/Background.ts";
import {Environment} from "../environment/Environment.ts";
import {ToneMapping} from "../../helpers/postProcessUtils/postProcessUtilsTypes.ts";


export class Scene extends BaseLayer {
    public device!: GPUDevice;
    private activeCamera: Camera;
    public lightManager: LightManager;
    public skinManager: SkinManager;
    public computeManager: ComputeManager;
    public backgroundManager: Background;
    public environmentManager: Environment;

    public largeBufferMap: Map<string, LargeBuffer> = new Map<string, LargeBuffer>()

    public globalBindGroup!: GPUBindGroup;
    public readonly renderLoopRunAble: Map<string, (...args: any[]) => void> = new Map()

    public readonly renderLoopAnimations: ((t: number) => void)[] = []
    public readonly _sceneObjectUpdateQueue: Map<number, SceneObject> = new Map();

    private _drawCalls: Set<Primitive> = new Set<Primitive>()
    renderQueue: { queue: Primitive[], needsUpdate: boolean } = {queue: [], needsUpdate: false}
    private _background: Primitive | null = null


    public ENV_MAX_LOD_COUNT!: number;
    private _TONE_MAPPING: ToneMapping = ToneMapping.NONE;
    private _TONE_MAPPING_DEPENDENT = new Set<Primitive>();
    private _ENV_EXPOSURE_DEPENDENT = new Set<Primitive>();


    addExposureDependent(p: Primitive): void {
        this._ENV_EXPOSURE_DEPENDENT.add(p);
    }

    set setToneMapping(value: ToneMapping) {
        this._TONE_MAPPING = value;
        this._TONE_MAPPING_DEPENDENT.forEach(primitive => primitive.updateToneMapping(value))
    }

    getToneMapping(primitive: Primitive): ToneMapping {
        this._TONE_MAPPING_DEPENDENT.add(primitive);
        return this._TONE_MAPPING;
    }

    public get background(): Primitive | null {
        return this._background;
    }

    public set setBackground(p: Primitive) {
        this._background = p;
    }

    drawCalls() {
        return this._drawCalls;
    }

    updateExposure(exposure: number) {
        this._ENV_EXPOSURE_DEPENDENT.forEach(primitive => primitive.updateExposure(exposure))
    }

    constructor(device: GPUDevice, canvas: HTMLCanvasElement, ctx: GPUCanvasContext, camera: Camera) {
        super(device, canvas, ctx);
        this.device = device;
        this.activeCamera = camera;
        this.lightManager = new LightManager(device)
        this.skinManager = new SkinManager(device, canvas, ctx);
        this.computeManager = new ComputeManager(device, canvas, ctx, this);
        this.backgroundManager = new Background(device, canvas, ctx, this);
        this.environmentManager = new Environment(device, this);

        this.setActiveCamera(camera)
        this.renderLoopRunAble.set("LightUpdate", this.lightManager.flushIfDirty)
        this.renderLoopRunAble.set("SkinUpdate", this.skinManager.updateSkins)
        this.renderLoopRunAble.set("IndirectDraw", this.computeManager.indirectDraw.renderLoop);
        this.renderLoopRunAble.set("LOD", this.computeManager.lodSelection.renderLoop);
        this.renderLoopRunAble.set("FrustumCulling", this.computeManager.frustumCulling.renderLoop);

    }


    update(commandEncoder: GPUCommandEncoder, primitives: Primitive[]) {
        const time = performance.now() / 1000;
        this.renderLoopAnimations.forEach((func) => func(time))

        const viewMatrix = this.activeCamera.getViewMatrix()
        const projectionMatrix = this.activeCamera.getProjectionMatrix()


        const lightUpdate = this.renderLoopRunAble.get("LightUpdate")!;
        if ((lightUpdate as any).call(this.lightManager)) this.setBindGroup()


        const skinUpdate = this.renderLoopRunAble.get("SkinUpdate")!;
        skinUpdate();

        // compute shaders
        const indirect = this.largeBufferMap.get("Indirect") as LargeBuffer
        const index = this.largeBufferMap.get("Index") as LargeBuffer

        if (indirect.needsUpdate) this.computeManager.indirectDraw.applyIndirectUpdate()
        if (index.needsUpdate) this.computeManager.indirectDraw.applyIndexUpdate()

        const lodRunAble = this.renderLoopRunAble.get("LOD")!
        const frustumCullingRunAble = this.renderLoopRunAble.get("FrustumCulling")!
        lodRunAble.apply(this.computeManager.lodSelection, [commandEncoder]);
        frustumCullingRunAble.apply(this.computeManager.frustumCulling, [commandEncoder, viewMatrix, projectionMatrix]);


        // render
        const pass = commandEncoder.beginRenderPass({
            label: "main pass",
            depthStencilAttachment: {
                view: Scene.depthTexture.createView(),
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

        const indirectDrawRunAble = this.renderLoopRunAble.get("IndirectDraw")!

        indirectDrawRunAble.apply(this.computeManager.indirectDraw, [primitives, this.background, pass])

        pass.end()
    }

    public setBindGroup() {
        const cameraBuffers = this.activeCamera.getBuffers();
        this.globalBindGroup = Scene.device.createBindGroup({
            label: "globalBindGroup",
            entries: [{
                resource: {
                    buffer: cameraBuffers.projection
                },
                binding: 0,
            }, {
                resource: {
                    buffer: cameraBuffers.view
                },
                binding: 1,
            }, {
                resource: {
                    buffer: Scene.timeBuffer
                },
                binding: 2,
            }, {
                resource: {
                    buffer: Scene.resolutionBuffer
                },
                binding: 3,
            }, {
                resource: {
                    buffer: cameraBuffers.position
                },
                binding: 4,
            }, {
                resource: {
                    buffer: Scene.deltaBuffer
                },
                binding: 5,
            }, {
                resource: {
                    buffer: this.lightManager.lightsBuffer.ambient
                },
                binding: 6,
            }, {
                resource: {
                    buffer: this.lightManager.lightsBuffer.directional
                },
                binding: 7,
            }, {
                resource: {
                    buffer: this.lightManager.lightsBuffer.counts
                },
                binding: 8,
            }, {
                resource: this.brdfLut?.createView() ?? BaseLayer.dummyTextures.brdfLut.createView(),
                binding: 9,
            }, {
                resource: this.environmentManager.prefilteredMap?.createView({dimension: "cube"}) ?? BaseLayer.dummyTextures.prefiltered.createView({dimension: "cube"}),
                binding: 10,
            }, {
                resource: this.environmentManager.irradianceMap?.createView({dimension: "cube"}) ?? BaseLayer.dummyTextures.irradiance.createView({dimension: "cube"}),
                binding: 11,
            }, {
                resource: BaseLayer.iblSampler,
                binding: 12,
            }],
            layout: BaseLayer.globalBindGroupLayout
        })
    }

    public setActiveCamera(camera: Camera): void {
        this.activeCamera = camera;
        this.setBindGroup()
    }

    public getActiveCamera(): Camera {
        return this.activeCamera;
    }

    public set appendDrawCall(primitive: Primitive) {
        this.renderQueue.needsUpdate = true
        this._drawCalls.add(primitive);
    }

}