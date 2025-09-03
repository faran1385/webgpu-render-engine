import {mat4} from "gl-matrix";
import {createGPUBuffer, updateBuffer} from "../../helpers/global.helper.ts";
import {Scene} from "../scene/Scene.ts";
import {
    cubeIndices,
    cubemapVertexShader,
    cubePositions, views,
} from "./cubeData.ts";
import {
    charlieBRDFLUTCode,
    charliePrefilterCode,
    ggxBRDFLUTCode,
    ggxPrefilterCode
} from "../../helpers/pbrShaderFunctions.ts";
import {quadVertices} from "./quadData.ts";
import {BaseLayer} from "../../layers/baseLayer.ts";
import {ProcessManager} from "../loader/processManager.ts";

export class Environment {
    private device!: GPUDevice;
    private scene!: Scene;
    public irradianceMap: null | GPUTexture = null;
    public ggxPrefilteredMap: null | GPUTexture = null;
    public charliePrefilteredMap: null | GPUTexture = null;
    private exposure = 1;
    private processManager!: ProcessManager;

    constructor(device: GPUDevice, scene: Scene) {
        this.device = device;
        this.scene = scene;
    }

    private createIrradiance(cubeMap: GPUTexture, IRRADIANCE_SIZE: number) {
        const irradiance = this.device.createTexture({
            size: [IRRADIANCE_SIZE, IRRADIANCE_SIZE, 6],
            label: "irradiance map",
            dimension: "2d",
            format: "rgba8unorm",
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        });

        const depthTexture = this.device.createTexture({
            label: "irradiance map depth",
            size: {width: IRRADIANCE_SIZE, height: IRRADIANCE_SIZE},
            format: "depth24plus",
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });
        const depthTextureView = depthTexture.createView();

        const uniformBuffer = this.device.createBuffer({
            size: Float32Array.BYTES_PER_ELEMENT * 16,
            label: "env uniform buffer",
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        const phiSamples = 180;     // azimuth steps
        const thetaSamples = 64;    // polar steps

        const deltaPhi = (2 * Math.PI) / phiSamples;
        const deltaTheta = (0.5 * Math.PI) / thetaSamples;

        const fragmentShader = /* wgsl */ `
          @group(0) @binding(1) var environmentMap: texture_cube<f32>;
          @group(0) @binding(2) var samplerEnv: sampler;
        
          const PI = 3.14159265359;
          const TWO_PI = PI * 2.0;
          const HALF_PI = PI * 0.5;
          
          override DELTA_PHI=0.;
          override DELTA_THETA=0.;
          
          @fragment
          fn main(@location(0) worldPosition: vec3f) -> @location(0) vec4f {
            let N = normalize(vec3f(worldPosition.x,-worldPosition.y,worldPosition.z));
            var irradiance = vec3f(0.0, 0.0, 0.0);
            var up = vec3f(0.0, 1.0, 0.0);

            let right = normalize(cross(up, N));
            up = normalize(cross(N, right));

            var color = vec3(0.0);
            var sampleCount = 0u;
            for (var phi = 0.0; phi < TWO_PI; phi += DELTA_PHI) {
                for (var theta = 0.0; theta < HALF_PI; theta += DELTA_THETA) {
                    let tempVec = cos(phi) * right + sin(phi) * up;
                    let sampleVector = cos(theta) * N + sin(theta) * tempVec;
                    color += textureSample(environmentMap,samplerEnv, sampleVector).rgb * cos(theta) * sin(theta);
                    sampleCount++;
                }
            }
            
                return vec4(PI * color / f32(sampleCount), 1.0);
          }
        `;

        const verticesBuffer = createGPUBuffer(this.device, cubePositions, GPUBufferUsage.VERTEX, "irradiance vertices buffer")
        const sampler = this.device.createSampler({
            label: "irradiance map",
            magFilter: "linear",
            minFilter: "linear",
        });

        const pipeline = this.device.createRenderPipeline({
            label: "irradiance map",
            layout: "auto",
            vertex: {
                module: this.device.createShaderModule({code: cubemapVertexShader}),
                entryPoint: "main",
                buffers: [
                    {
                        arrayStride: Float32Array.BYTES_PER_ELEMENT * 3,
                        attributes: [
                            {
                                shaderLocation: 0,
                                offset: 0,
                                format: "float32x3",
                            },
                        ],
                    },
                ],
            },
            fragment: {
                module: this.device.createShaderModule({code: fragmentShader}),
                entryPoint: "main",
                constants: {
                    DELTA_PHI: deltaPhi,
                    DELTA_THETA: deltaTheta
                },
                targets: [{format: "rgba8unorm"}],
            },
            primitive: {
                topology: "triangle-list",
            },
            depthStencil: {
                format: "depth24plus",
                depthWriteEnabled: true,
                depthCompare: "less",
            },
        });

        const bindGroup = this.device.createBindGroup({
            layout: pipeline.getBindGroupLayout(0),
            entries: [
                {
                    binding: 0,
                    resource: {
                        buffer: uniformBuffer,
                        offset: 0,
                        size: Float32Array.BYTES_PER_ELEMENT * 16,
                    },
                },
                {
                    binding: 1,
                    resource: cubeMap.createView({dimension: "cube"}),
                },
                {
                    binding: 2,
                    resource: sampler,
                },
            ],
        });

        const projection = mat4.perspective(mat4.create(), Math.PI / 2, 1, 0.1, 10);
        const indexBuffer = createGPUBuffer(this.device, cubeIndices, GPUBufferUsage.INDEX, "irradiance index buffer")
        let totalPercentage = 0;
        for (let i = 0; i < 6; i += 1) {
            const commandEncoder = this.device.createCommandEncoder();
            const passEncoder = commandEncoder.beginRenderPass({
                colorAttachments: [
                    {
                        view: irradiance.createView({
                            baseArrayLayer: i,
                            arrayLayerCount: 1,
                        }),
                        loadOp: "load",
                        storeOp: "store",
                    },
                ],
                depthStencilAttachment: {
                    view: depthTextureView,
                    depthClearValue: 1.0,
                    depthLoadOp: "clear",
                    depthStoreOp: "store",
                },
            });

            const view = views[i];
            const modelViewProjectionMatrix = mat4.multiply(mat4.create(), projection, view);
            updateBuffer(this.device, uniformBuffer, modelViewProjectionMatrix as Float32Array);

            passEncoder.setPipeline(pipeline);
            passEncoder.setViewport(0, 0, IRRADIANCE_SIZE, IRRADIANCE_SIZE, 0, 1);
            passEncoder.setVertexBuffer(0, verticesBuffer);
            passEncoder.setBindGroup(0, bindGroup);
            passEncoder.setIndexBuffer(indexBuffer, "uint16")
            passEncoder.drawIndexed(cubeIndices.length);
            passEncoder.end();

            this.device.queue.submit([commandEncoder.finish()]);
            BaseLayer.device.queue.onSubmittedWorkDone().then(() => {
                totalPercentage += 100 / 6;
                this.processManager.updateIndex(0, Math.min(totalPercentage, 100))
            })
        }

        verticesBuffer.destroy();
        depthTexture.destroy();
        indexBuffer.destroy();
        return irradiance
    }

    private createPrefiltered(
        cubeMap: GPUTexture,
        SAMPLE_COUNT: number,
        TEXTURE_RESOLUTION: number,
        vertexShader: string,
        fragmentShader: string,
        processIndex: number
    ) {
        const ROUGHNESS_LEVELS = Math.floor(Math.log2(TEXTURE_RESOLUTION));
        this.scene.ENV_MAX_LOD_COUNT = ROUGHNESS_LEVELS;

        const prefilteredTexture = this.device.createTexture({
            size: [TEXTURE_RESOLUTION, TEXTURE_RESOLUTION, 6],
            dimension: "2d",
            format: "rgba8unorm",
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
            mipLevelCount: ROUGHNESS_LEVELS
        });

        const depthTexture = this.device.createTexture({
            label: "prefilter map depth",
            size: {width: TEXTURE_RESOLUTION, height: TEXTURE_RESOLUTION},
            format: "depth24plus",
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
            mipLevelCount: ROUGHNESS_LEVELS,
        });

        const verticesBuffer = createGPUBuffer(this.device, cubePositions, GPUBufferUsage.VERTEX, "prefiltered vertices buffer")
        const sampler = this.device.createSampler({
            label: "prefilter map",
            magFilter: "linear",
            minFilter: "linear",
        });
        const uniformBuffer = this.device.createBuffer({
            size: Float32Array.BYTES_PER_ELEMENT * (16 + 4),
            label: "env uniform buffer",
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        const pipeline = this.device.createRenderPipeline({
            label: "prefilter map",
            layout: "auto",
            vertex: {
                module: this.device.createShaderModule({code: vertexShader}),
                entryPoint: "main",
                buffers: [
                    {
                        arrayStride: Float32Array.BYTES_PER_ELEMENT * 3,
                        attributes: [
                            {
                                shaderLocation: 0,
                                offset: 0,
                                format: "float32x3",
                            },
                        ],
                    },
                ],
            },
            fragment: {
                constants: {
                    SAMPLE_COUNT,
                    TEXTURE_RESOLUTION
                },
                module: this.device.createShaderModule({code: fragmentShader}),
                entryPoint: "main",
                targets: [{format: "rgba8unorm"}],
            },
            primitive: {
                topology: "triangle-list",
            },
            depthStencil: {
                format: "depth24plus",
                depthWriteEnabled: true,
                depthCompare: "less",
            },
        });
        const projection = mat4.perspective(mat4.create(), Math.PI / 2, 1, 0.1, 10);
        const indexBuffer = createGPUBuffer(this.device, cubeIndices, GPUBufferUsage.INDEX, "irradiance index buffer")

        for (let mip = 0; mip < ROUGHNESS_LEVELS; mip += 1) {
            const width = prefilteredTexture.width >> mip;
            const height = prefilteredTexture.height >> mip;

            const roughness = mip / (ROUGHNESS_LEVELS - 1);

            const bindGroup = this.device.createBindGroup({
                layout: pipeline.getBindGroupLayout(0),
                entries: [
                    {
                        binding: 0,
                        resource: {
                            buffer: uniformBuffer,
                            offset: 0,
                            size: Float32Array.BYTES_PER_ELEMENT * (16 + 4),
                        },
                    },
                    {
                        binding: 1,
                        resource: cubeMap.createView({dimension: "cube"}),
                    },
                    {
                        binding: 2,
                        resource: sampler,
                    },
                ],
            });

            const depthTextureView = depthTexture.createView({
                baseMipLevel: mip,
                mipLevelCount: 1,
            });
            let totalPercentage = 0;
            for (let i = 0; i < 6; i += 1) {
                const commandEncoder = this.device.createCommandEncoder();
                const passEncoder = commandEncoder.beginRenderPass({
                    colorAttachments: [
                        {
                            view: prefilteredTexture.createView({
                                baseArrayLayer: i,
                                arrayLayerCount: 1,
                                baseMipLevel: mip,
                                mipLevelCount: 1,
                            }),
                            clearValue: [0.3, 0.3, 0.3, 1],
                            loadOp: "load",
                            storeOp: "store",
                        },
                    ],
                    depthStencilAttachment: {
                        view: depthTextureView,
                        depthClearValue: 1.0,
                        depthLoadOp: "clear",
                        depthStoreOp: "store",
                    },
                });

                const view = views[i];
                const modelViewProjectionMatrix = mat4.multiply(mat4.create(), projection, view);

                this.device.queue.writeBuffer(
                    uniformBuffer,
                    0,
                    new Float32Array([...modelViewProjectionMatrix, roughness, 0, 0, 0])
                        .buffer,
                );

                passEncoder.setPipeline(pipeline);
                passEncoder.setViewport(0, 0, width, height, 0, 1);
                passEncoder.setVertexBuffer(0, verticesBuffer);
                passEncoder.setBindGroup(0, bindGroup);
                passEncoder.setIndexBuffer(indexBuffer, "uint16")
                passEncoder.drawIndexed(cubeIndices.length);
                passEncoder.end();

                this.device.queue.submit([commandEncoder.finish()]);
                BaseLayer.device.queue.onSubmittedWorkDone().then(() => {
                    totalPercentage += 100 / 6;
                    this.processManager.updateIndex(processIndex, Math.min(totalPercentage, 100))
                })
            }
        }
        verticesBuffer.destroy();
        depthTexture.destroy();
        indexBuffer.destroy();
        return prefilteredTexture;
    }

    setExposure(number: number) {
        this.exposure = number;
        this.scene.updateExposure(this.exposure)
    }

    getExposure() {
        return this.exposure
    }

    private initBRDFLUT(vertexShader: string, fragmentShader: string, checkTexture: GPUTexture | null, format: GPUTextureFormat, processIndex: number) {
        if (checkTexture) {
            this.processManager.updateIndex(processIndex, 100)
            return
        }
        ;
        const BRDF_LUT_SIZE = 64;

        const texture = this.device.createTexture({
            label: "BRDF LUT",
            size: {width: BRDF_LUT_SIZE, height: BRDF_LUT_SIZE},
            format,
            usage:
                GPUTextureUsage.RENDER_ATTACHMENT |
                GPUTextureUsage.TEXTURE_BINDING |
                GPUTextureUsage.COPY_DST,
        });


        const pipeline = this.device.createRenderPipeline({
            label: "BRDF convolution",
            layout: "auto",
            vertex: {
                module: this.device.createShaderModule({code: vertexShader}),
                entryPoint: "main",
                buffers: [
                    {
                        arrayStride: Float32Array.BYTES_PER_ELEMENT * 4,
                        attributes: [
                            {
                                shaderLocation: 0,
                                offset: 0,
                                format: "float32x2",
                            },
                            {
                                shaderLocation: 1,
                                offset: Float32Array.BYTES_PER_ELEMENT * 2,
                                format: "float32x2",
                            },
                        ],
                    },
                ],
            },
            fragment: {
                module: this.device.createShaderModule({code: fragmentShader}),
                entryPoint: "main",
                targets: [{format}],
            },
            primitive: {
                topology: "triangle-list",
            },
            depthStencil: {
                format: "depth24plus",
                depthWriteEnabled: true,
                depthCompare: "less",
            },
        });

        const depthTexture = this.device.createTexture({
            label: "BRDF LUT depth",
            size: {width: BRDF_LUT_SIZE, height: BRDF_LUT_SIZE},
            format: "depth24plus",
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });

        const depthTextureView = depthTexture.createView();

        const vertexBuffer = createGPUBuffer(this.device, quadVertices, GPUBufferUsage.VERTEX, "brdf lut quad vertexBuffer")

        const commandEncoder = this.device.createCommandEncoder();
        const passEncoder = commandEncoder.beginRenderPass({
            colorAttachments: [
                {
                    view: texture.createView(),
                    clearValue: {r: 0, g: 0, b: 0, a: 1},
                    loadOp: "clear",
                    storeOp: "store",
                },
            ],
            depthStencilAttachment: {
                view: depthTextureView,
                depthClearValue: 1.0,
                depthLoadOp: "clear",
                depthStoreOp: "store",
            },
        });

        passEncoder.setPipeline(pipeline);
        passEncoder.setVertexBuffer(0, vertexBuffer);
        passEncoder.draw(6);
        passEncoder.end();

        this.device.queue.submit([commandEncoder.finish()]);
        BaseLayer.device.queue.onSubmittedWorkDone().then(() => {
            this.processManager.updateIndex(processIndex, 100)
        })
        vertexBuffer.destroy();
        depthTexture.destroy();
        return texture
    }

    async setEnvironment(cubeMap: GPUTexture, prefilterSampleCount: number, prefilterTextureResolution: number, irradianceResolution: number, process: (totalPercentage: number) => void) {
        this.processManager = new ProcessManager(5, process)

        const irradiance = this.createIrradiance(cubeMap, irradianceResolution)
        const ggxPrefiltered = this.createPrefiltered(cubeMap,
            prefilterSampleCount,
            prefilterTextureResolution,
            ggxPrefilterCode.vertex,
            ggxPrefilterCode.fragment, 1)

        const charliePrefiltered = this.createPrefiltered(cubeMap,
            prefilterSampleCount,
            prefilterTextureResolution,
            charliePrefilterCode.vertex,
            charliePrefilterCode.fragment, 2)


        const ggxBRDFLUT = this.initBRDFLUT(ggxBRDFLUTCode.vertex, ggxBRDFLUTCode.fragment, BaseLayer.ggxBRDFLUTTexture, "rg16float", 3)
        const charlieBRDFLUT = this.initBRDFLUT(charlieBRDFLUTCode.vertex, charlieBRDFLUTCode.fragment, BaseLayer.charlieBRDFLUTTexture, "r16float", 4)
        if (ggxBRDFLUT) BaseLayer.ggxBRDFLUTTexture = ggxBRDFLUT;
        if (charlieBRDFLUT) BaseLayer.charlieBRDFLUTTexture = charlieBRDFLUT;

        this.irradianceMap?.destroy()
        this.ggxPrefilteredMap?.destroy()
        this.charliePrefilteredMap?.destroy()

        this.irradianceMap = irradiance;
        this.ggxPrefilteredMap = ggxPrefiltered;
        this.charliePrefilteredMap = charliePrefiltered;

        this.scene.setBindGroup()
    }
}