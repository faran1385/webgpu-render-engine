import {PostProcessUtils, ToneMapping} from "../postProcessUtils/postProcessUtilsTypes.ts";
import {mat4} from "gl-matrix";
import {postProcessUtilsMap, toneMappingMap} from "../postProcessUtils/postProcessUtilsShaderCodes.ts";
import {createGPUBuffer, updateBuffer} from "../../helpers/global.helper.ts";

// @ts-ignore
import hdrParser from 'parse-hdr'

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

    private fillCubeMap(hdrTexture: GPUTexture, cubeSize: number, toneMapping: ToneMapping, exposure: number) {
        const cubeMap = this.device.createTexture({
            size: [cubeSize, cubeSize, 6],
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


        const cubeMapShaderModule = this.device.createShaderModule({
            code: `
                // resolution of the cubemap face (e.g., 128.0 or 256.0)
                const cubeSize: f32 = ${cubeSize};
                const PI: f32 = 3.14159265359;
                
                struct VertexOut {
                    @builtin(position) position: vec4f,
                    @location(0) uv: vec2f,
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
                
                    var output: VertexOut;
                    output.position = vec4f(pos[vertexIndex], 0.0, 1.0);
                    output.uv = uv[vertexIndex];
                    return output;
                }

                

                @group(0) @binding(0) var hdrTexture: texture_2d<f32>;
                @group(0) @binding(1) var hdrSampler: sampler;
                @group(0) @binding(2) var<uniform> faceMatrix: mat4x4<f32>;
                @group(0) @binding(3) var<uniform> exposure: f32;
                
                ${postProcessUtilsMap.get(PostProcessUtils.GAMMA_CORRECTION)}
                ${postProcessUtilsMap.get(PostProcessUtils.EXPOSURE)}
                ${toneMappingMap.get(toneMapping)?.shader}

                @fragment
                fn fs_main(in: VertexOut) -> @location(0) vec4f {
                    let ndc = vec2f(in.uv.x, 1.0 - in.uv.y) * 2.0 - vec2f(1.0);
                    let dir = normalize((faceMatrix * vec4f(ndc.x, ndc.y, 1.0, 0.0)).xyz);

                
                    // Convert direction to equirectangular UV
                    let lon = atan2(dir.z, dir.x);       // -PI to PI
                    let lat = asin(dir.y);               // -PI/2 to PI/2
                
                    let u = lon / (2.0 * PI) + 0.5;       // 0 to 1
                    let v = 0.5 - lat / PI;               // 0 to 1
                
                    let hdrColor = textureSample(hdrTexture, hdrSampler, vec2f(u, v));
                    let toneMappedColor = ${toneMappingMap.get(toneMapping)?.functionName}(hdrColor.rgb);
                    
                    // Then gamma correct:
                    let exposured=applyExposure(toneMappedColor,0.8);
                    let gammaCorrected = applyGamma(exposured,exposure);
                    
                    return vec4f(gammaCorrected, 1.0);
                }
            `
        })


        const cubeMapBindGroupLayout = this.device.createBindGroupLayout({
            entries: [{
                binding: 0,
                texture: {
                    sampleType: "float"
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
                visibility: GPUShaderStage.FRAGMENT
            }, {
                buffer: {
                    type: "uniform"
                },
                binding: 3,
                visibility: GPUShaderStage.FRAGMENT
            }]
        })
        const cubeMapSampler = this.device.createSampler({
            addressModeU: "repeat",
            addressModeV: "repeat",
            addressModeW: "repeat",
            magFilter: "linear",
            minFilter: "linear"
        })
        const exposureTypedArray = new Float32Array([exposure])
        const exposureBuffer = createGPUBuffer(this.device, exposureTypedArray, GPUBufferUsage.UNIFORM, "EnvMap Exposure");
        const cubeMapBindGroup = this.device.createBindGroup({
            layout: cubeMapBindGroupLayout,
            entries: [
                {binding: 1, resource: cubeMapSampler},
                {binding: 0, resource: hdrTexture.createView()},
                {binding: 2, resource: {buffer: vpBuffer}},
                {
                    binding: 3,
                    resource: {buffer: exposureBuffer}
                },
            ],
        })


        const cubeMapPipeline = this.device.createRenderPipeline({
            layout: this.device.createPipelineLayout({
                bindGroupLayouts: [cubeMapBindGroupLayout]
            }),
            vertex: {module: cubeMapShaderModule, entryPoint: 'vs_main'},
            fragment: {
                module: cubeMapShaderModule,
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
                    view: cubeMap.createView({
                        dimension: "2d",
                        baseArrayLayer: i,
                        arrayLayerCount: 1,
                    }),
                }],
            });

            pass.setBindGroup(0, cubeMapBindGroup);
            pass.setPipeline(cubeMapPipeline);
            pass.draw(6);
            pass.end();
            this.device.queue.submit([encoder.finish()]);
        }

        vpBuffer.destroy()
        hdrTexture.destroy()
        exposureBuffer.destroy()
        return cubeMap
    }

    async load(url: string, toneMapping: ToneMapping, exposure: number | undefined = undefined) {
        const {exposure: defaultExposure, texture, cubeSize} = await this.createHdrTexture(url)
        return this.fillCubeMap(texture, cubeSize, toneMapping, exposure ?? defaultExposure)
    }
}