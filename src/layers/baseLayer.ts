import {downsampleWGSL, updateBuffer} from "../helpers/global.helper.ts";
// @ts-ignore
import lodComputeShader from "../shaders/builtin/lod.wgsl?raw"

import {Scene} from "../engine/scene/Scene.ts";

// @ts-ignore
import frustumComputeShader from "../shaders/builtin/frustomCulling.wgsl?raw"
import {MaterialInstance} from "../engine/Material/Material.ts";
import {Primitive} from "../engine/primitive/Primitive.ts";
import {HashGenerator} from "../engine/GPURenderSystem/Hasher/HashGenerator.ts";
import {GPUCache} from "../engine/GPURenderSystem/GPUCache/GPUCache.ts";

export class BaseLayer {
    // base
    public readonly ctx: GPUCanvasContext;
    static format: GPUTextureFormat;
    public readonly canvas: HTMLCanvasElement;
    public static device: GPUDevice;
    public static hasher: HashGenerator;
    public static gpuCache: GPUCache;
    public static sceneOpaqueTexture: GPUTexture | null = null
    public static sceneOpaqueDepthTexture: GPUTexture | null = null
    public static transmissionPrimitives = new Set<Primitive>()


    // global data
    private static _timeBuffer: GPUBuffer;
    private static _resolutionBuffer: GPUBuffer;
    private static _deltaBuffer: GPUBuffer;
    private static _lastFrameTime: number;
    private static _depthTexture: GPUTexture;
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
    // global resources
    static ggxBRDFLUTTexture: GPUTexture | null = null;
    static charlieBRDFLUTTexture: GPUTexture | null = null;
    private static _dummyTextures: {
        irradiance: GPUTexture;
        prefiltered: GPUTexture;
        brdfLut: GPUTexture;
        pbr: GPUTexture;
    }
    private static _samplers: {
        ibl: GPUSampler,
        default: GPUSampler,
        linear: GPUSampler,
    };
    static bindGroupLayouts: {
        globalBindGroupLayout: GPUBindGroupLayout;
        background: {
            layout: GPUBindGroupLayout,
            hash: number
        }
    };
    public static downSamplePipeline: GPURenderPipeline;
    public static downSampleUniformBuffer: GPUBuffer;
    public static materialUpdateQueue = new Set<MaterialInstance>();
    public static pipelineUpdateQueue = new Set<Primitive>()


    public setActiveScene(activeScene: Scene): void {
        BaseLayer.activeScene = activeScene;
    }


    static get samplers() {
        return BaseLayer._samplers
    }

    static get dummyTextures() {
        return BaseLayer._dummyTextures
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
    }


    async initialize() {
        BaseLayer.format = navigator.gpu.getPreferredCanvasFormat()

        const shaderModule = BaseLayer.device.createShaderModule({
            code: downsampleWGSL
        });
        BaseLayer.downSampleUniformBuffer = BaseLayer.device.createBuffer({
            size: 16,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,

        })
        BaseLayer.downSamplePipeline = BaseLayer.device.createRenderPipeline({
            layout: "auto",
            vertex: {
                module: shaderModule,
                entryPoint: "vs_main",
            },
            fragment: {
                module: shaderModule,
                entryPoint: "fs_main",
                targets: [
                    {
                        format: BaseLayer.format,
                    }
                ],
            },
            primitive: {
                topology: "triangle-list",
                stripIndexFormat: undefined,
            },
        });

        BaseLayer._depthTexture = BaseLayer.device.createTexture({
            size: {width: window.innerWidth, height: window.innerHeight, depthOrArrayLayers: 1},
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
            label: "depthTexture",
            format: "depth24plus"
        });

        this.windowResizeHandler()
        BaseLayer._dummyTextures = {
            irradiance: BaseLayer.device.createTexture({
                size: [128, 128, 6],
                format: "r8unorm",
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
                mipLevelCount: 8
            }),
            brdfLut: BaseLayer.device.createTexture({
                size: [1, 1, 1],
                format: "r8unorm",
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
                mipLevelCount: 1
            }),
            pbr: BaseLayer.device.createTexture({
                size: [1, 1, 1],
                format: "r8unorm",
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
                mipLevelCount: 1
            }),
            prefiltered: BaseLayer.device.createTexture({
                size: [1, 1, 6],
                format: "r8unorm",
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
                mipLevelCount: 1
            })
        }

        BaseLayer._samplers = {
            ibl: BaseLayer.device.createSampler({
                magFilter: "linear",
                addressModeU: "clamp-to-edge",
                addressModeV: "clamp-to-edge",
                minFilter: "linear",
                mipmapFilter: "linear"
            }),
            default: BaseLayer.device.createSampler({
                magFilter: "linear",
                addressModeU: "repeat",
                addressModeV: "repeat",
                minFilter: "linear",
                mipmapFilter: "linear"
            }),
            linear: BaseLayer.device.createSampler({
                minFilter: "linear",
                magFilter: "linear",
                mipmapFilter: "linear",
                addressModeU: "clamp-to-edge",
                addressModeV: "clamp-to-edge",
            })

        };

        BaseLayer._lastFrameTime = performance.now();
        BaseLayer._timeBuffer = BaseLayer.device.createBuffer({
            size: 4,
            label: "time buffer",
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        })
        BaseLayer._resolutionBuffer = BaseLayer.device.createBuffer({
            size: 8,
            label: "resolution",
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        })
        BaseLayer._deltaBuffer = BaseLayer.device.createBuffer({
            size: 4,
            label: "delta buffer",
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        })


        window.addEventListener("resize", () => {
            this.windowResizeHandler()
        })

        const globalBindGroupEntries: GPUBindGroupLayoutEntry[] = [
            {
                visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                binding: 0,
                buffer: {
                    type: "uniform"
                }
            },
            {
                visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
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
            },
            {
                visibility: GPUShaderStage.FRAGMENT,
                binding: 13,
                texture: {
                    sampleType: "float"
                }
            },
            {
                visibility: GPUShaderStage.FRAGMENT,
                binding: 14,
                texture: {
                    sampleType: "float",
                    viewDimension: "cube"
                }
            },
            {
                visibility: GPUShaderStage.FRAGMENT,
                binding: 15,
                texture: {
                    sampleType: "float",
                }
            }
        ]

        BaseLayer.bindGroupLayouts = {
            background: {
                layout: BaseLayer.device.createBindGroupLayout({
                    entries: [{
                        texture: {
                            sampleType: "float",
                            viewDimension: "cube"
                        },
                        binding: 1,
                        visibility: GPUShaderStage.FRAGMENT
                    }, {
                        sampler: {
                            type: "filtering"
                        },
                        binding: 0,
                        visibility: GPUShaderStage.FRAGMENT
                    }],
                    label: 'global background layout'
                }),
                hash: 1.1
            },
            globalBindGroupLayout: BaseLayer.device.createBindGroupLayout({
                label: "globalBindGroupLayout",
                entries: globalBindGroupEntries
            }),
        }
        this.setLod()
        this.setFrustumCulling()
        this.updateGlobalBuffers()
        this.updateResolution()
        BaseLayer.hasher = new HashGenerator();
        await BaseLayer.hasher.init()
        BaseLayer.gpuCache = new GPUCache();
    }

    static setSceneOpaqueOnlyTexture() {
        const mipLevels = Math.floor(Math.log2(Math.max(window.innerWidth, window.innerHeight))) + 1;

        BaseLayer.sceneOpaqueTexture = this.device.createTexture({
            size: [window.innerWidth, window.innerHeight],
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT,
            format: BaseLayer.format,
            mipLevelCount: mipLevels
        })
        BaseLayer.sceneOpaqueDepthTexture = this.device.createTexture({
            size: [window.innerWidth, window.innerHeight],
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
            label: "depthTexture transmissionTexture",
            format: "depth24plus",
        })
        this.activeScene.setBindGroup()
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

        if (BaseLayer.transmissionPrimitives.size > 0) {
            BaseLayer.setSceneOpaqueOnlyTexture()
        }
    }

}