import {mat4, vec3} from "gl-matrix";
import {OrbitControls} from "../scene/camera/controls.ts";
import {Pane} from "tweakpane";
import {updateBuffer} from "../helpers/global.helper.ts";

import {LODRange} from "../scene/loader/loaderTypes.ts";
import {SceneObject} from "../scene/sceneObject/sceneObject.ts";
import {TypedArray} from "@gltf-transform/core";
import {LargeBuffer} from "../scene/computation/IndirectDraw/IndirectDraw.ts";

export type readyBindGroup = { bindGroup: GPUBindGroup, layout: GPUBindGroupLayout }


export type activeCamera = {
    view: GPUBuffer,
    projection: GPUBuffer,
    position: GPUBuffer
}


export type MeshRenderData = {
    name: string,
    normal?: { buffer: GPUBuffer, data: Float32Array, },
    model: { buffer: GPUBuffer, data: Float32Array },
}

export type RenderAblePrim = {
    id: number,
    pipeline: GPURenderPipeline,
    bindGroups: GPUBindGroup[],
    vertexBuffers: GPUBuffer[],
    lodRanges?: LODRange[],
    indexData?: TypedArray
    side?: "back" | "front"
}


export type RenderAble = {
    renderData: MeshRenderData,
    primitive: RenderAblePrim,
    sceneObject: SceneObject,
}


export class BaseLayer {
    // base
    public readonly ctx: GPUCanvasContext;
    public static _format: GPUTextureFormat;
    public readonly canvas: HTMLCanvasElement;
    public static device: GPUDevice;
    // large buffers
    public static largeBufferMap: Map<string, LargeBuffer> = new Map<string, LargeBuffer>()

    // renderLoop functions
    public static readonly renderLoopRunAble: Map<string, (...args: any[]) => void> = new Map()
    public static readonly renderLoopAnimations: ((t: number) => void)[] = []

    // global data
    private static _globalBindGroup: readyBindGroup;
    private static _timeBuffer: GPUBuffer;
    private static _resolutionBuffer: GPUBuffer;
    private static _deltaBuffer: GPUBuffer;
    private static _lastFrameTime: number;
    private static _depthTexture: GPUTexture;
    private static _activeCamera: activeCamera;

    private static _pane: Pane;
    private static _controls: OrbitControls;
    public static _updateQueue: Map<number, SceneObject> = new Map();
    private static _drawCalls: { opaque: RenderAble[], transparent: RenderAble[] } = {
        opaque: [],
        transparent: []
    };
    private static _baseLayerInitialized: boolean = false;
    protected static renderQueue: { queue: RenderAble[], needsUpdate: boolean } = {queue: [], needsUpdate: false}

    protected static get drawCalls() {
        return BaseLayer._drawCalls;
    }

    protected getCameraVP() {
        const updatedData = BaseLayer.controls.update();
        return {projectionMatrix: updatedData.projectionMatrix, viewMatrix: updatedData.viewMatrix}
    }

    public static getCameraPosition() {
        const {viewMatrix} = BaseLayer.controls.update();
        const cameraWorldMatrix = mat4.invert(mat4.create(), viewMatrix);

        return mat4.getTranslation(vec3.create(), cameraWorldMatrix)
    }

    protected static set appendDrawCall(sceneObject: SceneObject) {
        this.renderQueue.needsUpdate = true
        sceneObject.primitives?.forEach((primitive) => {
            let renderAble = {
                sceneObject: sceneObject,
                primitive,
                renderData: {
                    name: sceneObject.name ?? 'draw call',
                    model: {
                        buffer: sceneObject.modelBuffer as GPUBuffer,
                        data: sceneObject.worldMatrix as Float32Array
                    },
                    normal: sceneObject.normalBuffer ? {
                        buffer: sceneObject.normalBuffer,
                        data: sceneObject.normalMatrix as Float32Array
                    } : undefined
                }
            }

            if (primitive.side) {
                BaseLayer._drawCalls["transparent"].push(renderAble)
            } else {
                BaseLayer._drawCalls["opaque"].push(renderAble)
            }
        })
    }

    protected static get format(): GPUTextureFormat {
        return BaseLayer._format
    }

    protected static get globalBindGroup(): readyBindGroup {
        return BaseLayer._globalBindGroup
    }

    protected static get depthTexture(): GPUTexture {
        return BaseLayer._depthTexture
    }

    public static get controls(): OrbitControls {
        return BaseLayer._controls
    }

    protected static get deltaBuffer(): GPUBuffer {
        return BaseLayer._deltaBuffer
    }

    protected static get resolutionBuffer(): GPUBuffer {
        return BaseLayer._resolutionBuffer
    }

    protected static get timeBuffer(): GPUBuffer {
        return BaseLayer._timeBuffer
    }


    protected static set setActiveCamera(camera: activeCamera) {
        BaseLayer._activeCamera = camera
    }

    public static get activeCamera(): activeCamera {
        return BaseLayer._activeCamera
    }


    protected static get pane(): Pane {
        return BaseLayer._pane
    }

    constructor(device: GPUDevice, canvas: HTMLCanvasElement, ctx: GPUCanvasContext) {
        BaseLayer.device = device;
        this.canvas = canvas;
        this.ctx = ctx;
        if (this.constructor === BaseLayer && !BaseLayer._baseLayerInitialized) {
            this.initialize()
            BaseLayer._baseLayerInitialized = true;
        }
    }


    public update() {
        const {viewMatrix, projectionMatrix, position} = BaseLayer._controls.update()
        this.updateGlobalBuffers(position as Float32Array, projectionMatrix as Float32Array, viewMatrix as Float32Array)
    }


    private initialize() {
        BaseLayer._format = navigator.gpu.getPreferredCanvasFormat()
        BaseLayer._pane = new Pane();

        BaseLayer._depthTexture = BaseLayer.device.createTexture({
            size: {width: window.innerWidth, height: window.innerHeight, depthOrArrayLayers: 1},
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
            label: "depthTexture",
            format: "depth24plus"
        });


        BaseLayer._controls = new OrbitControls({
            canvas: this.canvas,
            initialPosition: [0, 0, 30],
            rotateSpeed: 0.5,
            zoomSpeed: 0.5,
            panSpeed: 0.3,
            dampingFactor: 0.1,
            fov: Math.PI / 4,
            near: 0.1,
            far: 1000,
        });

        const {viewMatrix, projectionMatrix, position} = BaseLayer._controls.update()
        BaseLayer.setActiveCamera = {
            projection: BaseLayer.device.createBuffer({
                size: (projectionMatrix as Float32Array).byteLength,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
            }),
            view: BaseLayer.device.createBuffer({
                size: (viewMatrix as Float32Array).byteLength,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
            }),
            position: BaseLayer.device.createBuffer({
                size: 12,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
            }),
        }

        this.windowResizeHandler()

        BaseLayer._lastFrameTime = performance.now();
        BaseLayer._timeBuffer = BaseLayer.device.createBuffer({
            size: 4,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        })
        BaseLayer._resolutionBuffer = BaseLayer.device.createBuffer({
            size: 8,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        })
        BaseLayer._deltaBuffer = BaseLayer.device.createBuffer({
            size: 4,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        })

        window.addEventListener("resize", () => {
            this.windowResizeHandler()
        })


        const paneElement = BaseLayer.pane.element;
        paneElement.style.zIndex = "103";
        paneElement.style.position = "absolute";
        paneElement.style.right = "10px";
        paneElement.style.top = "10px";
        paneElement.style.width = "300px";
        document.body.appendChild(paneElement)


        BaseLayer._globalBindGroup = this.setGlobalBindGroup();
        this.updateGlobalBuffers(position as Float32Array, projectionMatrix as Float32Array, viewMatrix as Float32Array)
    }


    private updateGlobalBuffers = (position: Float32Array, projectionMatrix: Float32Array, viewMatrix: Float32Array) => {

        const currentTime = performance.now();
        const deltaTime = (currentTime - BaseLayer._lastFrameTime) / 1000;

        BaseLayer._lastFrameTime = currentTime;
        updateBuffer(BaseLayer.device, BaseLayer._resolutionBuffer, new Float32Array([window.innerWidth, window.innerHeight]))
        updateBuffer(BaseLayer.device, BaseLayer._timeBuffer, new Float32Array([performance.now() / 1000]))
        updateBuffer(BaseLayer.device, BaseLayer._deltaBuffer, new Float32Array([deltaTime]))
        updateBuffer(BaseLayer.device, BaseLayer.activeCamera.projection, projectionMatrix)
        updateBuffer(BaseLayer.device, BaseLayer.activeCamera.view, viewMatrix)
        updateBuffer(BaseLayer.device, BaseLayer.activeCamera.position, position)
    }


    private setGlobalBindGroup = (): readyBindGroup => {
        const bindGroupLayout = BaseLayer.device.createBindGroupLayout({
            label: "globalBindGroupLayout",
            entries: [
                {
                    visibility: GPUShaderStage.VERTEX,
                    binding: 0,
                    buffer: {
                        type: "uniform"
                    }
                },
                {
                    visibility: GPUShaderStage.VERTEX,
                    binding: 1,
                    buffer: {
                        type: "uniform"
                    }
                },
                {
                    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
                    binding: 2,
                    buffer: {
                        type: "uniform"
                    }
                }, {
                    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                    binding: 3,
                    buffer: {
                        type: "uniform"
                    }
                }, {
                    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                    binding: 4,
                    buffer: {
                        type: "uniform"
                    }
                },
                {
                    visibility: GPUShaderStage.VERTEX | GPUShaderStage.COMPUTE,
                    binding: 5,
                    buffer: {
                        type: "uniform"
                    }
                }
            ]
        })


        const bindGroup = BaseLayer.device.createBindGroup({
            label: "globalBindGroup",
            entries: [{
                resource: {
                    buffer: BaseLayer.activeCamera.projection
                },
                binding: 0,
            }, {
                resource: {
                    buffer: BaseLayer.activeCamera.view
                },
                binding: 1,
            }, {
                resource: {
                    buffer: BaseLayer._timeBuffer
                },
                binding: 2,
            }, {
                resource: {
                    buffer: BaseLayer._resolutionBuffer
                },
                binding: 3,
            }, {
                resource: {
                    buffer: BaseLayer.activeCamera.position
                },
                binding: 4,
            }, {
                resource: {
                    buffer: BaseLayer._deltaBuffer
                },
                binding: 5,
            }],
            layout: bindGroupLayout
        })

        return {
            layout: bindGroupLayout,
            bindGroup
        }
    }


    private windowResizeHandler() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;

        const {projectionMatrix} = BaseLayer._controls.update()
        mat4.perspective(projectionMatrix, Math.PI / 4, window.innerWidth / window.innerHeight, 0.1, 100)
        updateBuffer(BaseLayer.device, BaseLayer.activeCamera.projection, projectionMatrix);
        BaseLayer._depthTexture.destroy();
        BaseLayer._depthTexture = BaseLayer.device.createTexture({
            size: {width: window.innerWidth, height: window.innerHeight, depthOrArrayLayers: 1},
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
            label: "depthTexture",
            format: "depth24plus"
        });
    }

}