import {mat4} from "gl-matrix";
import {updateBuffer} from "../../helpers/global.helper.ts";
import {Scene} from "../scene/Scene.ts";

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
        const irradiance = this.device.createTexture({
            size: [32, 32, 6],
            dimension: "2d",
            format: "rgba32float",
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        });

        const vpBuffer = this.device.createBuffer({
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            size: 64
        })
        const projectionMatrix = mat4.perspective(mat4.create(), Math.PI / 2, 1, 0.1, 100);
        const lookAt = (eye: [number, number, number], center: [number, number, number], up: [number, number, number]) => {
            const view = mat4.create();
            mat4.lookAt(view, eye, center, up);
            return view;
        };

        const views = [
            lookAt([0, 0, 0], [1, 0, 0], [0, -1, 0]),     // +X
            lookAt([0, 0, 0], [-1, 0, 0], [0, -1, 0]),    // -X
            lookAt([0, 0, 0], [0, -1, 0], [0, 0, 1]),      // +Y
            lookAt([0, 0, 0], [0, 1, 0], [0, 0, -1]),    // -Y
            lookAt([0, 0, 0], [0, 0, -1], [0, -1, 0]),    // -Z
            lookAt([0, 0, 0], [0, 0, 1], [0, -1, 0]),     // +Z
        ];


        const shaderModule = this.device.createShaderModule({
            code: `
                const PI: f32 = 3.14159265359;
                
                struct VertexOut {
                    @builtin(position) position: vec4f,
                    @location(0) dir: vec3f,
                };
                
                @vertex
                fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOut {
                    var pos = array<vec2f, 6>(
                        vec2f(-1.0, -1.0),
                        vec2f(-1.0, 1.0),
                        vec2f(1.0, -1.0),
                        vec2f(1.0, -1.0),
                        vec2f(-1.0, 1.0),
                        vec2f(1.0, 1.0),
                    );
                
                    var uv = array<vec2f, 6>(
                        vec2f(0, 0),
                        vec2f(0, 1.0),
                        vec2f(1.0, 0),
                        vec2f(1.0, 0),
                        vec2f(0, 1.0),
                        vec2f(1.0, 1.0),
                    );
                
                    let ndc = vec2f(uv[vertexIndex].x, 1.0 - uv[vertexIndex].y) * 2.0 - vec2f(1.0);
                    let N = normalize((faceMatrix * vec4f(ndc.x, ndc.y, 1.0, 0.0)).xyz);
                    var output: VertexOut;
                    output.position = vec4f(pos[vertexIndex], 0.0, 1.0);
                    output.dir=N;
                    return output;
                }

                

                @group(0) @binding(0) var envMap: texture_cube<f32>;
                @group(0) @binding(1) var envSampler: sampler;
                @group(0) @binding(2) var<uniform> faceMatrix: mat4x4<f32>;
                

                @fragment
                fn fs_main(in: VertexOut) -> @location(0) vec4f {
                    let N=in.dir;
                     var irradiance = vec3<f32>(0.0);
                      let sampleDelta = 0.1;
                      var totalWeight = 0.0;
                    
                      for (var phi = 0.0; phi < 2.0 * 3.14159; phi += sampleDelta) {
                        for (var theta = 0.0; theta < 0.5 * 3.14159; theta += sampleDelta) {
                          let x = sin(theta) * cos(phi);
                          let y = sin(theta) * sin(phi);
                          let z = cos(theta);
                          let sampleVec = vec3<f32>(x, y, z);
                    
                          // Transform to world space aligned to N
                          let up = vec3<f32>(0.0, 1.0, 0.0);
                          let right = normalize(cross(up, N));
                          let newUp = cross(N, right);
                          let worldDir = normalize(sampleVec.x * right + sampleVec.y * newUp + sampleVec.z * N);
                    
                          let L = worldDir;
                          let NdotL = max(dot(N, L), 0.0);
                          irradiance += textureSample(envMap, envSampler, L).xyz * NdotL;
                          totalWeight += NdotL;
                        }
                      }
                    
                      irradiance /= totalWeight;
                      return vec4<f32>(irradiance, 1.0);
                }
            `
        })


        const bindGroupLayout = this.device.createBindGroupLayout({
            entries: [{
                binding: 0,
                texture: {
                    sampleType: "float",
                    viewDimension: "cube"
                },
                visibility: GPUShaderStage.FRAGMENT
            }, {
                binding: 1,
                sampler: {
                    type: "filtering"
                },
                visibility: GPUShaderStage.FRAGMENT
            }, {
                binding: 2,
                buffer: {
                    type: "uniform"
                },
                visibility: GPUShaderStage.VERTEX
            }]
        })
        const sampler = this.device.createSampler({
            addressModeU: "repeat",
            addressModeV: "repeat",
            addressModeW: "repeat",
            magFilter: "linear",
            minFilter: "linear"
        })
        const bindGroup = this.device.createBindGroup({
            layout: bindGroupLayout,
            entries: [
                {binding: 1, resource: sampler},
                {
                    binding: 0, resource: cubeMap.createView({
                        dimension: "cube"
                    })
                },
                {binding: 2, resource: {buffer: vpBuffer}},
            ],
        })


        const irradiancePipeline = this.device.createRenderPipeline({
            layout: this.device.createPipelineLayout({
                bindGroupLayouts: [bindGroupLayout]
            }),
            vertex: {module: shaderModule, entryPoint: 'vs_main'},
            fragment: {
                module: shaderModule,
                entryPoint: 'fs_main',
                targets: [{format: "rgba32float"}],
            },
            primitive: {topology: 'triangle-list'},
        });


        for (let i = 0; i < 6; i++) {
            const encoder = this.device.createCommandEncoder();
            const vpMatrix = mat4.multiply(mat4.create(), projectionMatrix, views[i]);

            updateBuffer(this.device, vpBuffer, vpMatrix);

            const pass = encoder.beginRenderPass({
                colorAttachments: [{
                    storeOp: "store",
                    loadOp: "load",
                    view: irradiance.createView({
                        dimension: "2d",
                        baseArrayLayer: i,
                        arrayLayerCount: 1,
                    }),
                }],
            });

            pass.setBindGroup(0, bindGroup);
            pass.setPipeline(irradiancePipeline);
            pass.draw(6);
            pass.end();
            this.device.queue.submit([encoder.finish()]);
        }

        vpBuffer.destroy()
        return irradiance
    }

    private createPrefiltered(cubeMap: GPUTexture) {
        const size = 128;
        const mipCount = Math.floor(Math.log2(size)) + 1;
        const prefilteredTexture = this.device.createTexture({
            size: [size, size, 6],
            dimension: "2d",
            format: "rgba32float",
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
            mipLevelCount: mipCount
        });

        const vpBuffer = this.device.createBuffer({
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            size: 64
        })
        const projectionMatrix = mat4.perspective(mat4.create(), Math.PI / 2, 1, 0.1, 100);
        const lookAt = (eye: [number, number, number], center: [number, number, number], up: [number, number, number]) => {
            const view = mat4.create();
            mat4.lookAt(view, eye, center, up);
            return view;
        };

        const views = [
            lookAt([0, 0, 0], [1, 0, 0], [0, -1, 0]),     // +X
            lookAt([0, 0, 0], [-1, 0, 0], [0, -1, 0]),    // -X
            lookAt([0, 0, 0], [0, -1, 0], [0, 0, 1]),      // +Y
            lookAt([0, 0, 0], [0, 1, 0], [0, 0, -1]),    // -Y
            lookAt([0, 0, 0], [0, 0, -1], [0, -1, 0]),    // -Z
            lookAt([0, 0, 0], [0, 0, 1], [0, -1, 0]),     // +Z
        ];


        const shaderModule = this.device.createShaderModule({
            code: `
                const PI: f32 = 3.14159265359;
                
                struct VertexOut {
                    @builtin(position) position: vec4f,
                    @location(0) dir: vec3f,
                };
                
                @vertex
                fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOut {
                    var pos = array<vec2f, 6>(
                        vec2f(-1.0, -1.0),
                        vec2f(-1.0, 1.0),
                        vec2f(1.0, -1.0),
                        vec2f(1.0, -1.0),
                        vec2f(-1.0, 1.0),
                        vec2f(1.0, 1.0),
                    );
                
                    var uv = array<vec2f, 6>(
                        vec2f(0, 0),
                        vec2f(0, 1.0),
                        vec2f(1.0, 0),
                        vec2f(1.0, 0),
                        vec2f(0, 1.0),
                        vec2f(1.0, 1.0),
                    );
                
                    let ndc = vec2f(uv[vertexIndex].x, 1.0 - uv[vertexIndex].y) * 2.0 - vec2f(1.0);
                    let N = normalize((faceMatrix * vec4f(ndc.x, ndc.y, 1.0, 0.0)).xyz);
                    var output: VertexOut;
                    output.position = vec4f(pos[vertexIndex], 0.0, 1.0);
                    output.dir=N;
                    return output;
                }

                struct PrefilterUniforms {
                  roughness: f32,
                  samples: u32,
                };

                @group(0) @binding(0) var envMap: texture_cube<f32>;
                @group(0) @binding(1) var envSampler: sampler;
                @group(0) @binding(2) var<uniform> faceMatrix: mat4x4<f32>;
                @group(0) @binding(3) var<uniform> uniforms: PrefilterUniforms;
                
                fn radicalInverse_VdC(bits: u32) -> f32 {
                  var x = bits;
                  x = (x << 16u) | (x >> 16u);
                  x = ((x & 0x55555555u) << 1u) | ((x & 0xAAAAAAAAu) >> 1u);
                  x = ((x & 0x33333333u) << 2u) | ((x & 0xCCCCCCCCu) >> 2u);
                  x = ((x & 0x0F0F0F0Fu) << 4u) | ((x & 0xF0F0F0F0u) >> 4u);
                  x = ((x & 0x00FF00FFu) << 8u) | ((x & 0xFF00FF00u) >> 8u);
                  return f32(x) * 2.3283064365386963e-10; // 1 / (2^32)
                }
                
                fn hammersley(i: u32, N: u32) -> vec2<f32> {
                  return vec2<f32>(f32(i) / f32(N), radicalInverse_VdC(i));
                }
                
                fn importanceSampleGGX(Xi: vec2<f32>, roughness: f32, N: vec3<f32>) -> vec3<f32> {
                  let a = roughness * roughness;
                
                  let phi = 2.0 * 3.14159265359 * Xi.x;
                  let cosTheta = sqrt((1.0 - Xi.y) / (1.0 + (a * a - 1.0) * Xi.y));
                  let sinTheta = sqrt(1.0 - cosTheta * cosTheta);
                
                  // Spherical to cartesian
                  let H = vec3<f32>(
                    cos(phi) * sinTheta,
                    sin(phi) * sinTheta,
                    cosTheta
                  );
                
                  // Orthonormal basis (T, B, N)
                  let up =select(vec3<f32>(1.0, 0.0, 0.0),vec3<f32>(0.0, 0.0, 1.0),abs(N.z) < 0.999);
                  let tangent = normalize(cross(up, N));
                  let bitangent = cross(N, tangent);
                
                  // Transform H to world space
                  return normalize(tangent * H.x + bitangent * H.y + N * H.z);
                }




                @fragment
                fn fs_main(in: VertexOut) -> @location(0) vec4f {
                
                    let N = normalize(in.dir);      
                    let R = N;                       
                    let V = R;
                
                    var totalColor = vec3<f32>(0.0);
                    var totalWeight = 0.0;
                
                    // Loop: importance sample GGX
                    let sampleCount = uniforms.samples;
                    for (var i: u32 = 0u; i < sampleCount; i = i + 1u) {
                    let Xi = hammersley(i, sampleCount);
                    let H = importanceSampleGGX(Xi, uniforms.roughness, N);
                    let L = normalize(2.0 * dot(V, H) * H - V); // Reflect
                
                    let NoL = max(dot(N, L), 0.0);
                        let sampleColor = textureSample(envMap, envSampler, L);
                    if (NoL > 0.0) {
                        totalColor += sampleColor.rgb * NoL;
                        totalWeight += NoL;
                    }
                    }

                    return vec4<f32>(totalColor / totalWeight, 1.0);

                }
            `
        })


        const bindGroupLayout = this.device.createBindGroupLayout({
            entries: [{
                binding: 0,
                texture: {
                    sampleType: "float",
                    viewDimension: "cube"
                },
                visibility: GPUShaderStage.FRAGMENT
            }, {
                binding: 1,
                sampler: {
                    type: "filtering"
                },
                visibility: GPUShaderStage.FRAGMENT
            }, {
                binding: 2,
                buffer: {
                    type: "uniform"
                },
                visibility: GPUShaderStage.VERTEX
            }, {
                binding: 3,
                buffer: {
                    type: "uniform"
                },
                visibility: GPUShaderStage.FRAGMENT
            }]
        })
        const sampler = this.device.createSampler({
            addressModeU: "repeat",
            addressModeV: "repeat",
            addressModeW: "repeat",
            magFilter: "linear",
            minFilter: "linear"
        })
        const uniformsBuffer = this.device.createBuffer({
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            size: 8
        })
        const bindGroup = this.device.createBindGroup({
            layout: bindGroupLayout,
            entries: [
                {binding: 1, resource: sampler},
                {
                    binding: 0, resource: cubeMap.createView({
                        dimension: "cube"
                    })
                },
                {binding: 2, resource: {buffer: vpBuffer}},
                {binding: 3, resource: {buffer: uniformsBuffer}},
            ],
        })


        const pipeline = this.device.createRenderPipeline({
            layout: this.device.createPipelineLayout({
                bindGroupLayouts: [bindGroupLayout]
            }),
            vertex: {module: shaderModule, entryPoint: 'vs_main'},
            fragment: {
                module: shaderModule,
                entryPoint: 'fs_main',
                targets: [{format: "rgba32float"}],
            },
            primitive: {topology: 'triangle-list'},
        });

        const uniformsData = new ArrayBuffer(8);
        const uniformsDataView = new DataView(uniformsData);
        uniformsDataView.setUint32(4, 256, true)
        for (let j = 0; j < mipCount; j++) {
            uniformsDataView.setFloat32(0, j / (mipCount - 1), true)
            this.device.queue.writeBuffer(uniformsBuffer, 0, uniformsData)
            for (let i = 0; i < 6; i++) {
                const encoder = this.device.createCommandEncoder();
                const vpMatrix = mat4.multiply(mat4.create(), projectionMatrix, views[i]);

                updateBuffer(this.device, vpBuffer, vpMatrix);

                const pass = encoder.beginRenderPass({
                    colorAttachments: [{
                        storeOp: "store",
                        loadOp: "load",
                        view: prefilteredTexture.createView({
                            dimension: "2d",
                            baseMipLevel: j,
                            baseArrayLayer: i,
                            arrayLayerCount: 1,
                            mipLevelCount: 1
                        }),
                    }],
                });

                pass.setBindGroup(0, bindGroup);
                pass.setPipeline(pipeline);
                pass.draw(6);
                pass.end();
                this.device.queue.submit([encoder.finish()]);
            }
        }
        vpBuffer.destroy()
        return prefilteredTexture;
    }


    async setEnvironment(cubeMap: GPUTexture) {
        const irradiance = this.createIrradiance(cubeMap)
        const prefiltered = this.createPrefiltered(cubeMap)
        await this.scene.initBRDFLUTTexture()
        this.irradianceMap=irradiance;
        this.prefilteredMap=prefiltered;
        this.scene.setBindGroup()
    }
}