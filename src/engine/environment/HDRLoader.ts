import {mat4} from "gl-matrix";
import {createGPUBuffer, updateBuffer} from "../../helpers/global.helper.ts";

// @ts-ignore
import hdrParser from 'parse-hdr'
import {cubeIndices, cubemapVertexShader, views, cubePositions} from "./cubeData.ts";

export class HDRLoader {
    private device: GPUDevice

    constructor(device: GPUDevice) {
        this.device = device;
    }

    private async createHdrTexture(url: string) {
        const response = await fetch(url);
        let rawData = await response.arrayBuffer();
        const {data, shape, exposure} = hdrParser(rawData);


        const cubeMapSize = shape[1];

        const hdrTexture = this.device.createTexture({
            size: [shape[0], shape[1]],
            format: "rgba32float",
            usage:
                GPUTextureUsage.TEXTURE_BINDING |
                GPUTextureUsage.COPY_DST |
                GPUTextureUsage.RENDER_ATTACHMENT,
        });
        const bytesPerRow = Math.ceil(shape[0] * 16 / 256) * 256;

        this.device.queue.writeTexture(
            {texture: hdrTexture},
            data,
            {bytesPerRow},
            {width: shape[0], height: shape[1]}
        );

        return {
            texture: hdrTexture,
            cubeSize: cubeMapSize,
            exposure
        }
    }

    private fillCubeMap(hdrTexture: GPUTexture, cubeSize: number) {
        const cubeMap = this.device.createTexture({
            size: [cubeSize, cubeSize, 6],
            dimension: "2d",
            format: "rgba8unorm-srgb",
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        });

        const vpBuffer = this.device.createBuffer({
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            size: 64
        })
        const projection = mat4.perspective(mat4.create(), Math.PI / 2, 1, 0.1, 10);

        const fragmentShader = `
                @group(0) @binding(1) var hdrTexture: texture_2d<f32>;
                @group(0) @binding(2) var hdrSampler: sampler;
               
                const invAtan = vec2f(0.1591, 0.3183);


                fn sampleSphericalMap(v: vec3f) -> vec2f {
                  var uv = vec2f(atan2(v.z, v.x), asin(v.y));
                  uv *= invAtan;
                  uv += 0.5;
                  return uv;
                }


                @fragment
                fn main(@location(0) worldPosition: vec3f) -> @location(0) vec4f {
                    let uv = sampleSphericalMap(normalize(worldPosition));
                    var color = textureSample(hdrTexture, hdrSampler, uv).rgb;
                    return vec4f(color, 1);
                }
            `

        const verticesBuffer = createGPUBuffer(this.device, cubePositions, GPUBufferUsage.VERTEX, "hdr vertices buffer")
        const indexBuffer = createGPUBuffer(this.device, cubeIndices, GPUBufferUsage.INDEX, "hdr index buffer")

        const cubeMapBindGroupLayout = this.device.createBindGroupLayout({
            entries: [{
                binding: 1,
                texture: {
                    sampleType: "float"
                },
                visibility: GPUShaderStage.FRAGMENT
            }, {
                binding: 2,
                sampler: {
                    type: "filtering"
                },
                visibility: GPUShaderStage.FRAGMENT
            }, {
                binding: 0,
                buffer: {
                    type: "uniform"
                },
                visibility: GPUShaderStage.VERTEX
            }]
        })
        const cubeMapSampler = this.device.createSampler({
            magFilter: "linear",
            minFilter: "linear"
        })
        const cubeMapBindGroup = this.device.createBindGroup({
            layout: cubeMapBindGroupLayout,
            entries: [
                {binding: 2, resource: cubeMapSampler},
                {binding: 1, resource: hdrTexture.createView()},
                {binding: 0, resource: {buffer: vpBuffer}},
            ],
        })


        const cubeMapPipeline = this.device.createRenderPipeline({
            layout: this.device.createPipelineLayout({
                bindGroupLayouts: [cubeMapBindGroupLayout]
            }),
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
                targets: [{format: "rgba8unorm-srgb"}],
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
            label: "cubemap depth texture",
            size: { width: cubeSize, height:  cubeSize},
            format: "depth24plus",
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });

        const depthTextureView = depthTexture.createView();

        for (let i = 0; i < 6; i++) {
            const encoder = this.device.createCommandEncoder();
            const vpMatrix = mat4.multiply(mat4.create(), projection, views[i]);

            updateBuffer(this.device, vpBuffer, vpMatrix);

            const pass = encoder.beginRenderPass({
                colorAttachments: [{
                    storeOp: "store",
                    loadOp: "load",
                    view: cubeMap.createView({
                        dimension: "2d",
                        baseArrayLayer: i,
                        arrayLayerCount: 1,
                    }),
                }],
                depthStencilAttachment: {
                    view: depthTextureView,
                    depthClearValue: 1.0,
                    depthLoadOp: "clear",
                    depthStoreOp: "store",
                },
                label:""
            });

            pass.setBindGroup(0, cubeMapBindGroup);
            pass.setPipeline(cubeMapPipeline);
            pass.setVertexBuffer(0,verticesBuffer)
            pass.setIndexBuffer(indexBuffer,"uint16")
            pass.drawIndexed(cubeIndices.length);
            pass.end();
            this.device.queue.submit([encoder.finish()]);
        }

        vpBuffer.destroy()
        hdrTexture.destroy()
        verticesBuffer.destroy()
        indexBuffer.destroy()
        return cubeMap
    }

    async load(url: string) {
        const {texture, cubeSize} = await this.createHdrTexture(url)
        return this.fillCubeMap(texture, cubeSize)
    }
}