import {BaseLayer} from "../layers/baseLayer.ts";
import {GeometryData, MeshData} from "./loader/loader.ts";
import {computeNormalMatrix3x4, createGPUBuffer} from "../helpers/global.helper.ts";
// @ts-ignore
import wireframeShader from "../shaders/builtin/wireframe.wgsl?raw"
import {mat4} from "gl-matrix";

export type wireframeArg = {
    lod?: {
        defaultLod: number,
        applyBaseVertex: boolean
    }
    buffer?: GPUBuffer
    color?: [number, number, number],
    thickness?: number,
    alphaThreshold?: number,
}

export class Wireframe extends BaseLayer {
    private readonly module: GPUShaderModule;
    private readonly args: wireframeArg;
    private readonly meshes: MeshData[];

    constructor(device: GPUDevice, canvas: HTMLCanvasElement, ctx: GPUCanvasContext, args: wireframeArg, meshes: MeshData[]) {
        super(device, canvas, ctx);
        this.args = args;
        this.module = device.createShaderModule({
            label: "wireframe module",
            code: wireframeShader as string
        })


        this.meshes = meshes.map((mesh) => {
            return {
                ...mesh,
                localMatrix: mesh.localMatrix,
                geometry: mesh.geometry.map((prim) => {
                    return {
                        ...prim,
                        uniforms: {},
                        material: {}
                    }
                })
            }
        })
    }

    applyTransformationsToRenderData({scale, translate, rotate}: {
        scale?: [number, number, number],
        translate?: [number, number, number],
        rotate?: {
            rad: number,
            axis: [number, number, number]
        },
    }) {

        this.meshes.forEach((item) => {
            const modelMatrix = mat4.clone(item.localMatrix as mat4);
            if (translate) {
                mat4.translate(modelMatrix, modelMatrix, translate)
            }
            if (rotate) {
                mat4.rotate(modelMatrix, modelMatrix, rotate.rad, rotate.axis)
            }
            if (scale) {
                mat4.scale(modelMatrix, modelMatrix, scale)
            }

            item.localMatrix.set(modelMatrix)

            const normalMatrix = computeNormalMatrix3x4(modelMatrix)
            item.normalMatrix.set(normalMatrix)
        })

    }

    public createBindGroupLayout(geom: GeometryData, additionalItems: GPUBindGroupLayoutEntry[], label: string): GPUBindGroupLayout {
        const entries: GPUBindGroupLayoutEntry[] = [];
        entries.push({
            binding: 0,
            visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
            buffer: {type: 'uniform'},
        });
        entries.push({
            binding: 1,
            visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
            buffer: {type: 'uniform'},
        });
        let bindingIndex = 2;
        Object.values(geom.uniforms).forEach(attr => {

            entries.push({
                binding: bindingIndex++,
                visibility: GPUShaderStage.VERTEX,
                buffer: {
                    type: 'uniform',
                    hasDynamicOffset: false,
                    minBindingSize: attr.array.byteLength,
                },
            });
        });

        if (geom.material?.color) {
            entries.push({
                binding: bindingIndex++,
                visibility: GPUShaderStage.FRAGMENT,
                buffer: {
                    type: 'uniform',
                    hasDynamicOffset: false,
                    minBindingSize: 4 * 4,
                },
            });
        }

        if (geom.material?.texture) {
            entries.push({
                binding: bindingIndex++,
                visibility: GPUShaderStage.FRAGMENT,
                texture: {},
            });
            entries.push({
                binding: bindingIndex++,
                visibility: GPUShaderStage.FRAGMENT,
                sampler: {},
            });
        }

        additionalItems.forEach((binding) => {
            entries.push({
                ...binding,
                binding: bindingIndex,
            });
            bindingIndex++
        })

        return this.device.createBindGroupLayout({entries, label});
    }

    public async createBindGroup(
        layout: GPUBindGroupLayout,
        mesh: MeshData,
        geom: GeometryData,
        additionalItems: GPUBindGroupEntry[],
        label: string,
    ) {
        const entries: GPUBindGroupEntry[] = [];
        let bindingIndex = 0;


        const matrixBuffer = createGPUBuffer(this.device, mesh.localMatrix, GPUBufferUsage.UNIFORM, `${label}-modelMatrix`)
        entries.push({binding: bindingIndex++, resource: {buffer: matrixBuffer}});

        const normalBuffer = createGPUBuffer(this.device, mesh.normalMatrix, GPUBufferUsage.UNIFORM, `${label}-normalMatrix`)

        entries.push({binding: bindingIndex++, resource: {buffer: normalBuffer}});


        for (const [key, attr] of Object.entries(geom.uniforms)) {
            const ub = createGPUBuffer(this.device, attr.array, GPUBufferUsage.UNIFORM, `${label}-uniform-${key}`)
            entries.push({binding: bindingIndex++, resource: {buffer: ub}});
        }

        if (geom.material?.color) {
            const colorArray = new Float32Array(geom.material.color);

            const colorBuffer = createGPUBuffer(this.device, colorArray, GPUBufferUsage.UNIFORM, `${label}-materialColor`)

            entries.push({binding: bindingIndex++, resource: {buffer: colorBuffer}});
        }

        if (geom.material?.texture) {
            const imageBitmap = await createImageBitmap(new Blob([geom.material.texture.array]));
            const texture = this.device.createTexture({
                size: [geom.material.texture.size[0], geom.material.texture.size[1]],
                format: 'rgba8unorm',
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
            });

            this.device.queue.copyExternalImageToTexture(
                {source: imageBitmap},
                {texture: texture},
                geom.material.texture.size
            );

            const sampler = this.device.createSampler({
                magFilter: 'linear',
                minFilter: 'linear',
            });

            entries.push({binding: bindingIndex++, resource: texture.createView()});
            entries.push({binding: bindingIndex++, resource: sampler});
        }

        additionalItems.forEach((binding) => {
            entries.push({...binding, binding: bindingIndex++});
        })
        return this.device.createBindGroup({layout, entries, label})
    }

    private async getBindGroups() {
        let uniformsBuffer: GPUBuffer;

        if ("buffer" in this.args) {
            uniformsBuffer = this.args.buffer as GPUBuffer;
        } else {
            const color = this.args.color ?? [1, 0, 0]
            const uniforms = new Float32Array([...color, this.args.thickness ?? .75, this.args.alphaThreshold ?? .5, 0, 0, 0])
            uniformsBuffer = createGPUBuffer(this.device, uniforms, GPUBufferUsage.UNIFORM, "uniform data")
        }


        return await Promise.all(this.meshes.map(async (mesh) => {
            return await Promise.all(mesh.geometry.map(async (prim, i) => {
                const layout = this.createBindGroupLayout(prim, [{
                    buffer: {
                        type: "read-only-storage"
                    },
                    binding: 2,
                    visibility: GPUShaderStage.VERTEX
                }, {
                    buffer: {
                        type: "read-only-storage"
                    },
                    binding: 3,
                    visibility: GPUShaderStage.VERTEX
                }, {
                    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                    binding: 4,
                    buffer: {
                        type: 'uniform'
                    }
                }], `${mesh.nodeName} Prim:${i}`)
                let indices: Uint32Array = new Uint32Array([]);

                if (prim.indexType === "uint32") {
                    indices = prim.indices as Uint32Array;
                } else if (prim.indexType === "uint16") {
                    const indicesU16 = prim.indices as Uint16Array;
                    const indicesU32 = new Uint32Array(indicesU16.length);
                    indicesU32.set(indicesU16);

                    indices = indicesU32;
                }

                if (this.args.lod && prim.lodRanges) {
                    const currentLod = prim.lodRanges[this.args.lod.defaultLod];
                    if (currentLod.count !== 0) {
                        indices = indices.slice(currentLod.start, currentLod.start + currentLod.count)
                    } else {
                        indices = new Uint32Array([0]);
                    }
                }

                return {
                    layout,
                    bindGroup: await this.createBindGroup(layout, mesh, prim, [{
                        resource: {
                            buffer: createGPUBuffer(this.device, prim.vertex.position?.array as Float32Array, GPUBufferUsage.STORAGE, "")
                        },
                        binding: 2,
                    }, {
                        resource: {
                            buffer: createGPUBuffer(this.device, indices, GPUBufferUsage.STORAGE, "")
                        },
                        binding: 3,
                    }, {
                        resource: {
                            buffer: uniformsBuffer
                        },
                        binding: 4
                    }], `${mesh.nodeName} Prim:${i}`)
                }
            }))
        }))
    }

    private getPipeline(layout: GPUBindGroupLayout) {

        return this.device.createRenderPipeline({
            label: "wireframe pipeline",
            vertex: {
                module: this.module,
                entryPoint: "vs",
            },
            fragment: {
                module: this.module,
                entryPoint: "fs",
                targets: [{
                    format: Wireframe.format,
                    blend: {
                        color: {
                            srcFactor: 'one',
                            dstFactor: 'one-minus-src-alpha',
                        },
                        alpha: {
                            srcFactor: 'one',
                            dstFactor: 'one-minus-src-alpha',
                        },
                    },
                    writeMask: GPUColorWrite.ALL
                }]
            },
            primitive: {
                topology: "triangle-list",
                cullMode: "none"
            },
            depthStencil: {
                depthCompare: "less-equal",
                depthWriteEnabled: true,
                format: "depth24plus"
            },
            layout: this.device.createPipelineLayout({
                label: "wireframe pipeline layout",
                bindGroupLayouts: [Wireframe.globalBindGroup.layout, layout]
            })
        })

    }

    public async draw() {

        const bindGroups = await this.getBindGroups()
        const mainPipeline = this.getPipeline(bindGroups[0][0].layout)

        const renderBundleEncoder = this.device.createRenderBundleEncoder({
            depthStencilFormat: "depth24plus",
            colorFormats: [Wireframe.format]
        })

        renderBundleEncoder.setPipeline(mainPipeline)
        renderBundleEncoder.setBindGroup(0, Wireframe.globalBindGroup.bindGroup)
        this.meshes.map(async (mesh, index) => {
            mesh.geometry.map(async (_, i) => {
                renderBundleEncoder.setBindGroup(1, bindGroups[index][i].bindGroup)
                renderBundleEncoder.draw(this.meshes[index].geometry[i].indexCount)
            })
        })

        return (renderBundleEncoder.finish())
    }
}