import {updateBuffer} from "../helpers/global.helper.ts";
// @ts-ignore
import lodComputeShader from "../shaders/builtin/lod.wgsl?raw"

import {Scene} from "../engine/scene/Scene.ts";

// @ts-ignore
import frustumComputeShader from "../shaders/builtin/frustomCulling.wgsl?raw"

export class BaseLayer {
    // base
    public readonly ctx: GPUCanvasContext;
    private static _format: GPUTextureFormat;
    public readonly canvas: HTMLCanvasElement;
    public static device: GPUDevice;

    // global data
    private static _timeBuffer: GPUBuffer;
    private static _resolutionBuffer: GPUBuffer;
    private static _deltaBuffer: GPUBuffer;
    private static _lastFrameTime: number;
    private static _depthTexture: GPUTexture;
    protected static globalBindGroupLayout: GPUBindGroupLayout;
    protected static activeScene: Scene;
    protected static frustumFixedComputeSetup: {
        shaderModule: GPUShaderModule,
        pipeline: GPUComputePipeline,
        bindGroupLayout: GPUBindGroupLayout
    }
    protected static lodFixedComputeSetup: {
        shaderModule: GPUShaderModule,
        pipeline: GPUComputePipeline,
        bindGroupLayout: GPUBindGroupLayout
    }
    // global textures
    private static _brdfLUTTexture: GPUTexture | null = null;
    private static _dummyEnvTextures: {
        irradiance: GPUTexture;
        prefiltered: GPUTexture;
        brdfLut: GPUTexture;
    }
    private static _iblSampler: GPUSampler;

    private static _baseLayerInitialized: boolean = false;


    public get brdfLut() {
        return BaseLayer._brdfLUTTexture
    }

    public set setBrdfLut(brdfLut: GPUTexture) {
        BaseLayer._brdfLUTTexture = brdfLut
    }

    public get format() {
        return BaseLayer._format
    }

    public setActiveScene(activeScene: Scene): void {
        BaseLayer.activeScene = activeScene;
    }

    protected static get format(): GPUTextureFormat {
        return BaseLayer._format
    }

    protected static get iblSampler() {
        return BaseLayer._iblSampler
    }

    protected static get dummyTextures() {
        return BaseLayer._dummyEnvTextures
    }

    protected static get depthTexture(): GPUTexture {
        return BaseLayer._depthTexture
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

    constructor(device: GPUDevice, canvas: HTMLCanvasElement, ctx: GPUCanvasContext) {
        BaseLayer.device = device;
        this.canvas = canvas;
        this.ctx = ctx;
        if (this.constructor === BaseLayer && !BaseLayer._baseLayerInitialized) {
            this.initialize()
            BaseLayer._baseLayerInitialized = true;
        }
    }


    private initialize() {
        BaseLayer._format = navigator.gpu.getPreferredCanvasFormat()

        BaseLayer._depthTexture = BaseLayer.device.createTexture({
            size: {width: window.innerWidth, height: window.innerHeight, depthOrArrayLayers: 1},
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
            label: "depthTexture",
            format: "depth24plus"
        });

        this.windowResizeHandler()
        BaseLayer._dummyEnvTextures = {
            irradiance: BaseLayer.device.createTexture({
                size: [128, 128, 6],
                format: this.format,
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
                mipLevelCount: 8
            }),
            brdfLut: BaseLayer.device.createTexture({
                size: [1, 1, 1],
                format: this.format,
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
                mipLevelCount: 1
            }),
            prefiltered: BaseLayer.device.createTexture({
                size: [1, 1, 6],
                format: this.format,
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
                mipLevelCount: 1
            })
        }
        BaseLayer._iblSampler = BaseLayer.device.createSampler({
            magFilter: "linear",
            addressModeU:"clamp-to-edge",
            addressModeV:"clamp-to-edge",
            minFilter: "linear",
            mipmapFilter:"nearest"
        });
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


        BaseLayer.globalBindGroupLayout = BaseLayer.device.createBindGroupLayout({
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
                },
                {
                    visibility: GPUShaderStage.FRAGMENT,
                    binding: 6,
                    buffer: {
                        type: "read-only-storage"
                    }
                },
                {
                    visibility: GPUShaderStage.FRAGMENT,
                    binding: 7,
                    buffer: {
                        type: "read-only-storage"
                    }
                },
                {
                    visibility: GPUShaderStage.FRAGMENT,
                    binding: 8,
                    buffer: {
                        type: "uniform"
                    }
                },
                {
                    visibility: GPUShaderStage.FRAGMENT,
                    binding: 9,
                    texture: {
                        sampleType: "float"
                    }
                },
                {
                    visibility: GPUShaderStage.FRAGMENT,
                    binding: 10,
                    texture: {
                        sampleType: "float",
                        viewDimension: "cube"
                    }
                },
                {
                    visibility: GPUShaderStage.FRAGMENT,
                    binding: 11,
                    texture: {
                        sampleType: "float",
                        viewDimension: "cube"
                    }
                }, {
                    visibility: GPUShaderStage.FRAGMENT,
                    binding: 12,
                    sampler: {
                        type: "filtering"
                    }
                }
            ]

        })
        this.setLod()
        this.setFrustumCulling()
        this.updateGlobalBuffers()
        this.updateResolution()
    }

    private setFrustumCulling(): void {
        const layout = BaseLayer.device.createBindGroupLayout({
            label: "frustum culling compute layout",
            entries: [{
                buffer: {
                    type: "uniform",
                },
                binding: 0,
                visibility: GPUShaderStage.COMPUTE
            }, {
                buffer: {
                    type: "read-only-storage",
                },
                binding: 1,
                visibility: GPUShaderStage.COMPUTE
            }, {
                buffer: {
                    type: "read-only-storage",
                },
                binding: 2,
                visibility: GPUShaderStage.COMPUTE
            }, {
                buffer: {
                    type: "storage",
                },
                binding: 3,
                visibility: GPUShaderStage.COMPUTE
            }]
        })

        const module = BaseLayer.device.createShaderModule({
            label: "frustum culling shader module",
            code: frustumComputeShader as string
        })

        const pipeline = BaseLayer.device.createComputePipeline({
            compute: {
                entryPoint: 'cs',
                module: module
            },
            label: "frustum culling pipeline",
            layout: BaseLayer.device.createPipelineLayout({
                label: "frustum culling  pipeline layout",
                bindGroupLayouts: [layout]
            })
        });

        BaseLayer.frustumFixedComputeSetup = {
            bindGroupLayout: layout,
            shaderModule: module,
            pipeline: pipeline
        }
    }

    private setLod(): void {
        const layout = BaseLayer.device.createBindGroupLayout({
            label: "lod compute layout",
            entries: [{
                buffer: {
                    type: "uniform",
                },
                binding: 0,
                visibility: GPUShaderStage.COMPUTE
            }, {
                buffer: {
                    type: "read-only-storage",
                },
                binding: 1,
                visibility: GPUShaderStage.COMPUTE
            }, {
                buffer: {
                    type: "read-only-storage",
                },
                binding: 2,
                visibility: GPUShaderStage.COMPUTE
            }, {
                buffer: {
                    type: "storage",
                },
                binding: 3,
                visibility: GPUShaderStage.COMPUTE
            }]
        })

        const computeModule = BaseLayer.device.createShaderModule({
            label: "lodSelection shader module",
            code: lodComputeShader!
        })

        const computePipeline = BaseLayer.device.createComputePipeline({
            compute: {
                entryPoint: 'cs',
                module: computeModule
            },
            label: "lodSelection pipeline",
            layout: BaseLayer.device.createPipelineLayout({
                label: "lodSelection pipeline layout",
                bindGroupLayouts: [layout]
            })
        });

        BaseLayer.frustumFixedComputeSetup = {
            bindGroupLayout: layout,
            shaderModule: computeModule,
            pipeline: computePipeline
        }
    }

    updateGlobalBuffers = () => {
        const currentTime = performance.now();
        const deltaTime = (currentTime - BaseLayer._lastFrameTime) / 1000;

        BaseLayer._lastFrameTime = currentTime;
        updateBuffer(BaseLayer.device, BaseLayer.timeBuffer, new Float32Array([performance.now() / 1000]))
        updateBuffer(BaseLayer.device, BaseLayer.deltaBuffer, new Float32Array([deltaTime]))
    }

    private updateResolution() {
        updateBuffer(BaseLayer.device, BaseLayer._resolutionBuffer, new Float32Array([window.innerWidth, window.innerHeight]))
    }


    private windowResizeHandler() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;

        BaseLayer._depthTexture.destroy();
        BaseLayer._depthTexture = BaseLayer.device.createTexture({
            size: {width: window.innerWidth, height: window.innerHeight, depthOrArrayLayers: 1},
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
            label: "depthTexture",
            format: "depth24plus"
        });
    }

}