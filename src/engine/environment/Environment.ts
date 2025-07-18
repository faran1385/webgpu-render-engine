import {mat4} from "gl-matrix";
import {createGPUBuffer, updateBuffer} from "../../helpers/global.helper.ts";
import {Scene} from "../scene/Scene.ts";
import {
    cubeIndices,
    cubemapVertexShader,
    cubemapViewMatricesInverted,
    cubePositions,
} from "./cubeData.ts";
import {
    distributionGGX,
    geometrySmith,
    hammersley,
    importanceSampleGGX,
    radicalInverseVdC
} from "../../helpers/pbrShaderFunctions.ts";
import {quadVertices} from "./quadData.ts";

export class Environment {
    private device!: GPUDevice;
    private scene!: Scene;
    public irradianceMap: null | GPUTexture = null;
    public prefilteredMap: null | GPUTexture = null;

    constructor(device: GPUDevice, scene: Scene) {
        this.device = device;
        this.scene = scene;
    }

    private createIrradiance(cubeMap: GPUTexture) {
        const IRRADIANCE_SIZE = 32;
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
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        const fragmentShader = /* wgsl */ `
          @group(0) @binding(1) var environmentMap: texture_cube<f32>;
          @group(0) @binding(2) var ourSampler: sampler;
        
          const PI = 3.14159265359;
        
          @fragment
          fn main(@location(0) worldPosition: vec4f) -> @location(0) vec4f {
            let normal = normalize(worldPosition.xyz);
            var irradiance = vec3f(0.0, 0.0, 0.0);
        
            var up = vec3f(0.0, 1.0, 0.0);
            let right = normalize(cross(up, normal));
            up = normalize(cross(normal, right));
        
            var sampleDelta = 0.025;
            var nrSamples = 0.0;
            for(var phi: f32 = 0.0; phi < 2.0 * PI; phi = phi + sampleDelta) {
              for(var theta : f32 = 0.0; theta < 0.5 * PI; theta = theta + sampleDelta) {
                // spherical to cartesian (in tangent space)
                let tangentSample: vec3f = vec3f(sin(theta) * cos(phi), sin(theta) * sin(phi), cos(theta));
                // tangent space to world
                let sampleVec = tangentSample.x * right + tangentSample.y * up + tangentSample.z * normal;
        
                irradiance = irradiance + textureSample(environmentMap, ourSampler, sampleVec).rgb * cos(theta) * sin(theta);
                nrSamples = nrSamples + 1.0;
              }
            }
            irradiance = PI * irradiance * (1.0 / nrSamples);
        
            return vec4f(irradiance, 1.0);
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

            const view = cubemapViewMatricesInverted[i];
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
        }
        verticesBuffer.destroy();
        depthTexture.destroy();
        indexBuffer.destroy();
        return irradiance
    }


    private createPrefiltered(cubeMap: GPUTexture,SAMPLE_COUNT:number) {
        const PREFILTER_MAP_SIZE = 128;
        const ROUGHNESS_LEVELS = 5;
        const prefilteredTexture = this.device.createTexture({
            size: [PREFILTER_MAP_SIZE, PREFILTER_MAP_SIZE, 6],
            dimension: "2d",
            format: "rgba8unorm",
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
            mipLevelCount: ROUGHNESS_LEVELS
        });

        const depthTexture = this.device.createTexture({
            label: "prefilter map depth",
            size: {width: PREFILTER_MAP_SIZE, height: PREFILTER_MAP_SIZE},
            format: "depth24plus",
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
            mipLevelCount: ROUGHNESS_LEVELS,
        });

        const vertexShader = /* wgsl */ `
        struct VSOut {
          @builtin(position) Position: vec4f,
          @location(0) worldPosition: vec4f,
        };
        
        struct Uniforms {
          modelViewProjectionMatrix: mat4x4f,
          roughness: f32,
        };

        @group(0) @binding(0) var<uniform> uniforms: Uniforms;
        
        @vertex
        fn main(@location(0) position: vec3f) -> VSOut {
          var output: VSOut;
          let worldPosition: vec4f=vec4f(position,1.);
          output.Position = uniforms.modelViewProjectionMatrix * worldPosition;
          output.worldPosition = worldPosition;
          return output;
        }
        `;

        const fragmentShader = /* wgsl */ `
        struct Uniforms {
          modelViewProjectionMatrix: mat4x4f,
          roughness: f32,
        };
        
        @group(0) @binding(0) var<uniform> uniforms: Uniforms;
        @group(0) @binding(1) var environmentMap: texture_cube<f32>;
        @group(0) @binding(2) var environmentSampler: sampler;
        
        const PI = 3.14159265359;
        
        ${distributionGGX}
        ${radicalInverseVdC}
        ${hammersley}
        ${importanceSampleGGX}
        
        @fragment
        fn main(@location(0) worldPosition: vec4f) -> @location(0) vec4f {
          var n = normalize(worldPosition.xyz);
        
          // Make the simplifying assumption that V equals R equals the normal
          let r = n;
          let v = r;
        
          let SAMPLE_COUNT: u32 = ${SAMPLE_COUNT};
          var prefilteredColor = vec3f(0.0, 0.0, 0.0);
          var totalWeight = 0.0;
        
          for (var i: u32 = 0u; i < SAMPLE_COUNT; i = i + 1u) {
            // Generates a sample vector that's biased towards the preferred alignment
            // direction (importance sampling).
            let xi = hammersley(i, SAMPLE_COUNT);
            let h = importanceSampleGGX(xi, n, uniforms.roughness);
            let l = normalize(2.0 * dot(v, h) * h - v);
        
            let nDotL = max(dot(n, l), 0.0);
        
            if(nDotL > 0.0) {
              // sample from the environment's mip level based on roughness/pdf
              let d = distributionGGX(n, h, uniforms.roughness);
              let nDotH = max(dot(n, h), 0.0);
              let hDotV = max(dot(h, v), 0.0);
              let pdf = d * nDotH / (4.0 * hDotV) + 0.0001;
        
              let resolution = ${PREFILTER_MAP_SIZE}.0; // resolution of source cubemap (per face)
              let saTexel = 4.0 * PI / (6.0 * resolution * resolution);
              let saSample = 1.0 / (f32(SAMPLE_COUNT) * pdf + 0.0001);
        
              let mipLevel = select(0.5 * log2(saSample / saTexel), 0.0, uniforms.roughness == 0.0);
        
              prefilteredColor += textureSampleLevel(environmentMap, environmentSampler, l, mipLevel).rgb * nDotL;
              totalWeight += nDotL;
            }
          }
        
          prefilteredColor = prefilteredColor / totalWeight;
          return vec4f(prefilteredColor, 1.0);
        }
        `;
        const verticesBuffer = createGPUBuffer(this.device, cubePositions, GPUBufferUsage.VERTEX, "prefiltered vertices buffer")
        const sampler = this.device.createSampler({
            label: "prefilter map",
            magFilter: "linear",
            minFilter: "linear",
        });
        const uniformBuffer = this.device.createBuffer({
            size: Float32Array.BYTES_PER_ELEMENT * (16 + 4),
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

                const view = cubemapViewMatricesInverted[i];
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
            }
        }
        verticesBuffer.destroy();
        depthTexture.destroy();
        indexBuffer.destroy();
        return prefilteredTexture;
    }

    private initBRDFLUT() {
        if (this.scene.brdfLut) return;
        const BRDF_LUT_SIZE = 64;

        const texture = this.device.createTexture({
            label: "BRDF LUT",
            size: {width: BRDF_LUT_SIZE, height: BRDF_LUT_SIZE},
            format: "rg16float",
            usage:
                GPUTextureUsage.RENDER_ATTACHMENT |
                GPUTextureUsage.TEXTURE_BINDING |
                GPUTextureUsage.COPY_DST,
        });

        const vertexShader = /* wgsl */ `
            struct VertexOutput {
              @builtin(position) Position: vec4f,
              @location(0) uv: vec2f,
            }
            
            @vertex
            fn main(@location(0) position: vec2f, @location(1) uv: vec2f) -> VertexOutput {
              var output: VertexOutput;
              output.Position = vec4f(position,0., 1.0);
              output.uv = uv;
              return output;
            }
        `;

        const fragmentShader = /* wgsl */ `
            const PI: f32 = 3.14159265359;
            
            ${radicalInverseVdC}
            ${hammersley}
            ${importanceSampleGGX}
            ${geometrySmith}
            
            // This one is different
            fn geometrySchlickGGX(nDotV: f32, roughness: f32) -> f32 {
              let a = roughness;
              let k = (a * a) / 2.0;
            
              let nom = nDotV;
              let denom = nDotV * (1.0 - k) + k;
            
              return nom / denom;
            }
            
            fn integrateBRDF(NdotV: f32, roughness: f32) -> vec2f {
              var V: vec3f;
              V.x = sqrt(1.0 - NdotV * NdotV);
              V.y = 0.0;
              V.z = NdotV;
            
              var A: f32 = 0.0;
              var B: f32 = 0.0;
            
              let N = vec3f(0.0, 0.0, 1.0);
            
              let SAMPLE_COUNT: u32 = 1024u;
              for(var i: u32 = 0u; i < SAMPLE_COUNT; i = i + 1u) {
                  let Xi: vec2f = hammersley(i, SAMPLE_COUNT);
                  let H: vec3f = importanceSampleGGX(Xi, N, roughness);
                  let L: vec3f = normalize(2.0 * dot(V, H) * H - V);
            
                  let NdotL: f32 = max(L.z, 0.0);
                  let NdotH: f32 = max(H.z, 0.0);
                  let VdotH: f32 = max(dot(V, H), 0.0);
            
                  if(NdotL > 0.0) {
                      let G: f32 = geometrySmith(N, V, L, roughness);
                      let G_Vis: f32 = (G * VdotH) / (NdotH * NdotV);
                      let Fc: f32 = pow(1.0 - VdotH, 5.0);
            
                      A += (1.0 - Fc) * G_Vis;
                      B += Fc * G_Vis;
                  }
              }
              A /= f32(SAMPLE_COUNT);
              B /= f32(SAMPLE_COUNT);
              return vec2f(A, B);
            }
            
            @fragment
            fn main(@location(0) uv: vec2f) -> @location(0) vec2f {
              let result = integrateBRDF(uv.x, 1 - uv.y);
              return result;
            }
            `;

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
                targets: [{format: "rg16float"}],
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
        vertexBuffer.destroy();
        depthTexture.destroy();
        this.scene.setBrdfLut = texture;
    }

    async setEnvironment(cubeMap: GPUTexture,prefilterSampleCount: number) {
        const irradiance = this.createIrradiance(cubeMap)
        const prefiltered = this.createPrefiltered(cubeMap,prefilterSampleCount)
        this.initBRDFLUT()
        this.irradianceMap = irradiance;
        this.prefilteredMap = prefiltered;
        this.scene.setBindGroup()
    }
}