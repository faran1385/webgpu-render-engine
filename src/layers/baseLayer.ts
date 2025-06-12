import {mat4} from "gl-matrix";
import {OrbitControls} from "../scene/camera/controls.ts";
import {Pane} from "tweakpane";
import {updateBuffer} from "../helpers/global.helper.ts";
import {Camera} from "../scene/camera/camera.ts";

import {LODRange} from "../scene/loader/loaderTypes.ts";
import {SceneObject} from "../scene/SceneObject/sceneObject.ts";

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
    indirect?: {
        indirectBuffer: GPUBuffer,
        indirectOffset: GPUSize64,
    },
    index: null | {
        buffer: GPUBuffer,
        type: "uint16" | "uint32",
    },
    lodRanges: LODRange[],
    side?: "back" | "front"
}
export type ComputeShader = {
    lod: { threshold: number },
    frustumCulling: {
        min: [number, number, number],
        max: [number, number, number],
    }
}

export type RenderAble = {
    renderData: MeshRenderData,
    computeShader?: ComputeShader,
    primitive: RenderAblePrim,
    sceneObject: SceneObject
}

export type TransparentRenderAble = RenderAble & { side: "back" | "front" }

export class BaseLayer {
    public readonly ctx: GPUCanvasContext;
    public static _format: GPUTextureFormat;
    public readonly device: GPUDevice;
    private static _globalBindGroup: readyBindGroup;
    private static _timeBuffer: GPUBuffer;
    private static _resolutionBuffer: GPUBuffer;
    private static _deltaBuffer: GPUBuffer;
    public readonly canvas: HTMLCanvasElement;
    private static _lastFrameTime: number;
    private static _controls: OrbitControls;
    private static _depthTexture: GPUTexture;
    private static _cameras: Camera[] = [];
    private static _activeCamera: activeCamera;
    public static _updateQueue: Map<number, SceneObject> = new Map();
    private static _activeCameraIndex: number = 0;
    private static _pane: Pane;
    private static _renderAbleSceneObjects: Set<SceneObject> = new Set<SceneObject>();
    private static _drawCalls: { opaque: RenderAble[], transparent: TransparentRenderAble[] } = {
        opaque: [],
        transparent: []
    };
    private static _initialized: boolean = false;

    protected static get drawCalls() {
        return BaseLayer._drawCalls;
    }

    protected static get renderAbleSceneObjects() {
        return BaseLayer._renderAbleSceneObjects;
    }

    protected static set appendDrawCall(SceneObject: SceneObject) {
        BaseLayer._renderAbleSceneObjects.add(SceneObject);
        SceneObject.primitives?.forEach((primitive, localIndex) => {
            let renderAble = {
                side: primitive.side,
                sceneObject: SceneObject,
                primitive,
                computeShader: SceneObject.computeShader,
                renderData: {
                    name: SceneObject.name ?? 'draw call',
                    model: {
                        buffer: SceneObject.modelBuffer as GPUBuffer,
                        data: SceneObject.worldMatrix as Float32Array
                    },
                    normal: SceneObject.normalBuffer ? {
                        buffer: SceneObject.normalBuffer,
                        data: SceneObject.normalMatrix as Float32Array
                    } : undefined
                }
            }

            if (primitive.side) {
                SceneObject.drawCallIndices?.push({
                    drawCallIndex: BaseLayer._drawCalls["transparent"].length,
                    localPrimitiveIndex: localIndex,
                    key: "transparent"
                })
                BaseLayer._drawCalls["transparent"].push(renderAble as TransparentRenderAble)
            } else {
                SceneObject.drawCallIndices?.push({
                    drawCallIndex: BaseLayer._drawCalls["opaque"].length,
                    localPrimitiveIndex: localIndex,
                    key: "opaque"
                })
                BaseLayer._drawCalls["opaque"].push(renderAble as RenderAble)
            }
        })
    }

    protected static editDrawCall(localPrimitivesIndex: number, drawCallIndex: number, where: "transparent" | "opaque", SceneObject: SceneObject) {
        const primitive = (SceneObject.primitives as RenderAblePrim[])[localPrimitivesIndex]
        let renderAble = {
            side: primitive.side,
            sceneObject: SceneObject,
            primitive,
            computeShader: SceneObject.computeShader,
            renderData: {
                name: SceneObject.name ?? 'draw call',
                model: {
                    buffer: SceneObject.modelBuffer as GPUBuffer,
                    data: SceneObject.worldMatrix as Float32Array
                },
                normal: SceneObject.normalBuffer ? {
                    buffer: SceneObject.normalBuffer,
                    data: SceneObject.normalMatrix as Float32Array
                } : undefined
            }
        }

        BaseLayer._drawCalls[where][drawCallIndex] = renderAble as any
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

    protected static get cameras(): Camera[] {
        return BaseLayer._cameras
    }

    protected static set setActiveCamera(camera: activeCamera) {
        BaseLayer._activeCamera = camera
    }

    public static set setActiveCameraIndex(index: number) {
        if (index === 0) {
            BaseLayer.controls.enable()
            this.controls.update()
        } else {
            BaseLayer.controls.disable()
        }
        BaseLayer._activeCameraIndex = index
    }

    public static get getActiveCameraIndex() {

        return BaseLayer._activeCameraIndex
    }

    public static get activeCamera(): activeCamera {
        return BaseLayer._activeCamera
    }


    public static set addCamera(camera: Camera) {
        BaseLayer._cameras.push(camera);
    }

    protected static get pane(): Pane {
        return BaseLayer._pane
    }

    constructor(device: GPUDevice, canvas: HTMLCanvasElement, ctx: GPUCanvasContext) {
        this.device = device;
        this.canvas = canvas;
        this.ctx = ctx;
        if (this.constructor === BaseLayer && !BaseLayer._initialized) {
            this.initialize()
            this.windowResizeHandler()
            BaseLayer._initialized = true;
        }
    }


    public update() {
        if (BaseLayer._activeCameraIndex === 0) {
            const {viewMatrix, projectionMatrix, position} = BaseLayer._controls.update()
            this.updateGlobalBuffers(position as Float32Array, projectionMatrix as Float32Array, viewMatrix as Float32Array)
        } else {
            const projectionMatrix = BaseLayer.cameras[BaseLayer._activeCameraIndex - 1].getProjectionMatrix()
            const viewMatrix = BaseLayer.cameras[BaseLayer._activeCameraIndex - 1].getViewMatrix()
            const position = BaseLayer.cameras[BaseLayer._activeCameraIndex - 1].getPosition()
            this.updateGlobalBuffers(position as Float32Array, projectionMatrix as Float32Array, viewMatrix as Float32Array)
        }
    }


    private initialize() {
        BaseLayer._format = navigator.gpu.getPreferredCanvasFormat()
        BaseLayer._pane = new Pane();

        BaseLayer._depthTexture = this.device.createTexture({
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
            projection: this.device.createBuffer({
                size: (projectionMatrix as Float32Array).byteLength,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
            }),
            view: this.device.createBuffer({
                size: (viewMatrix as Float32Array).byteLength,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
            }),
            position: this.device.createBuffer({
                size: 12,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
            }),
        }


        BaseLayer._lastFrameTime = performance.now();
        BaseLayer._timeBuffer = this.device.createBuffer({
            size: 4,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        })
        BaseLayer._resolutionBuffer = this.device.createBuffer({
            size: 8,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        })
        BaseLayer._deltaBuffer = this.device.createBuffer({
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
        updateBuffer(this.device, BaseLayer._resolutionBuffer, new Float32Array([window.innerWidth, window.innerHeight]))
        updateBuffer(this.device, BaseLayer._timeBuffer, new Float32Array([performance.now() / 1000]))
        updateBuffer(this.device, BaseLayer._deltaBuffer, new Float32Array([deltaTime]))
        updateBuffer(this.device, BaseLayer.activeCamera.projection, projectionMatrix)
        updateBuffer(this.device, BaseLayer.activeCamera.view, viewMatrix)
        updateBuffer(this.device, BaseLayer.activeCamera.position, position)
    }


    private setGlobalBindGroup = (): readyBindGroup => {
        const bindGroupLayout = this.device.createBindGroupLayout({
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


        const bindGroup = this.device.createBindGroup({
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
        if (BaseLayer._activeCameraIndex === 0) {
            const {projectionMatrix} = BaseLayer._controls.update()
            mat4.perspective(projectionMatrix, Math.PI / 4, window.innerWidth / window.innerHeight, 0.1, 100)
        }
        BaseLayer._depthTexture.destroy();
        BaseLayer._depthTexture = this.device.createTexture({
            size: {width: window.innerWidth, height: window.innerHeight, depthOrArrayLayers: 1},
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
            label: "depthTexture",
            format: "depth24plus"
        });
    }

}