import {GeometryData, LODRange, MeshData} from "../scene/loader/loader.ts";
import {computeNormalMatrix3x4, createGPUBuffer, updateBuffer} from "../helpers/global.helper.ts";
import {BaseLayer, MeshRenderData, RenderAble} from "../layers/baseLayer.ts";
import {mat4} from "gl-matrix";
import {ComputeFrustumCulling} from "../scene/computeFrustumCulling.ts";


type constructorEntry = {
    device: GPUDevice,
    canvas: HTMLCanvasElement,
    ctx: GPUCanvasContext,
    mesh: MeshData;
    geom: GeometryData
    shaderModule: GPUShaderModule
    vertexEntryPoint: string
    fragmentEntryPoint: string
    boundingComputer: ComputeFrustumCulling,
    depthFormat?: GPUTextureFormat,
    additionalBindLayoutItems?: GPUBindGroupLayoutEntry[],
    additionalBindGroupItems?: GPUBindGroupEntry[],
    normalBuffer?: GPUBuffer,
    modelBuffer?: GPUBuffer,
    primitive?: GPUPrimitiveState,
    colorTarget?: GPUColorTargetState[],
    label?: string,
}

type initEntry = {
    lod?: {
        defaultLod: number,
        applyBaseVertex: boolean
    },
    computeShader?: {
        lod: {
            threshold: number,
            applyBaseVertex: boolean
        }
    }
}

export class CustomModelRenderer extends BaseLayer {
    public renderData?: MeshRenderData;
    private readonly mesh: MeshData;
    private readonly geom: GeometryData
    private readonly shaderModule: GPUShaderModule
    private readonly vertexEntryPoint: string
    private readonly fragmentEntryPoint: string
    // @ts-ignore
    private readonly depthFormat: GPUTextureFormat = "depth24plus";
    private readonly additionalBindLayoutItems: GPUBindGroupLayoutEntry[];
    private readonly additionalBindGroupItems: GPUBindGroupEntry[];
    private readonly normalBuffer?: GPUBuffer;
    private readonly modelBuffer?: GPUBuffer;
    private readonly primitive?: GPUPrimitiveState;
    private readonly colorTarget?: GPUColorTargetState[];
    private readonly label: string;
    private pushedIndex: number = 0;
    private ComputeBoundingSphere: ComputeFrustumCulling;

    constructor({
                    device,
                    canvas,
                    ctx,
                    depthFormat,
                    shaderModule,
                    modelBuffer,
                    additionalBindLayoutItems,
                    additionalBindGroupItems,
                    label,
                    normalBuffer,
                    fragmentEntryPoint,
                    vertexEntryPoint,
                    geom,
                    mesh,
                    primitive,
                    colorTarget,
                    boundingComputer
                }: constructorEntry) {
        super(device, canvas, ctx)
        this.depthFormat = depthFormat ?? "depth24plus";
        this.shaderModule = shaderModule;
        this.modelBuffer = modelBuffer
        this.normalBuffer = normalBuffer
        this.additionalBindLayoutItems = additionalBindLayoutItems ?? [];
        this.additionalBindGroupItems = additionalBindGroupItems ?? [];
        this.label = label ?? "custom-model";
        this.fragmentEntryPoint = fragmentEntryPoint;
        this.vertexEntryPoint = vertexEntryPoint;
        this.geom = geom;
        this.mesh = mesh;
        this.primitive = primitive;
        this.colorTarget = colorTarget;
        this.ComputeBoundingSphere = boundingComputer;

    }


    public async init({lod, computeShader}: initEntry) {
        const bindgroupLayout = this.createBindGroupLayout();
        const bindGroup = await this.createBindGroup(bindgroupLayout,);
        const pipeline = this.createPipeline(bindgroupLayout,);

        let renderAble: RenderAble = {
            prims: [{
                pipeline: pipeline,
                bindGroups: [CustomModelRenderer.globalBindGroup.bindGroup, bindGroup],
                vertexBuffers: [],
                index: null,
                lodRanges: this.geom.lodRanges,
            }],
            renderData: this.renderData as MeshRenderData,
            computeShader: computeShader ? {
                frustumCulling: {
                    min: [0, 0, 0],
                    max: [0, 0, 0]
                },
                lod: {
                    ...computeShader.lod
                }
            } : undefined,
        }


        for (const key of Object.keys(this.geom.vertex)) {
            const attr = this.geom.vertex[key as keyof typeof this.geom.vertex];
            if (attr) {
                renderAble.prims[0].vertexBuffers.push(createGPUBuffer(this.device, attr.array, GPUBufferUsage.VERTEX, `${this.label}-vb-${key}`))
            }
        }
        const currentLod = (this.geom.lodRanges as LODRange[])[lod?.defaultLod ?? 0];

        renderAble.prims[0].indirect = {
            indirectBuffer: createGPUBuffer(this.device, new Uint32Array([
                lod ? currentLod.count : this.geom.indexCount,
                1,
                lod ? currentLod.start : 0,
                lod && lod.applyBaseVertex ? currentLod.baseVertex : 0,
                0
            ]), GPUBufferUsage.INDIRECT, `${this.label} prim indirect buffer`),
            indirectOffset: 0
        }


        if (this.geom.indexType !== "Unknown") {
            renderAble.prims[0].index = {
                buffer: createGPUBuffer(this.device, this.geom.indices as Uint32Array | Uint16Array, GPUBufferUsage.INDEX, "index buffer"),
                type: this.geom.indexType as "uint16" | "uint32"
            }
            renderAble.prims[0].indirect = {
                indirectBuffer: createGPUBuffer(this.device, new Uint32Array([
                    lod ? (this.geom.lodRanges as LODRange[])[lod.defaultLod].count : this.geom.indexCount,
                    1,
                    lod ? (this.geom.lodRanges as LODRange[])[lod.defaultLod].start : 0,
                    lod && lod.applyBaseVertex ? (this.geom.lodRanges as LODRange[])[lod.defaultLod].baseVertex : 0,
                    0
                ]), GPUBufferUsage.INDIRECT, `${this.mesh.nodeName} this.geom indirect buffer`),
                indirectOffset: 0
            }

        } else {
            renderAble.prims[0].indirect = {
                indirectBuffer: createGPUBuffer(this.device, new Uint32Array([
                    this.geom.indexCount,
                    1,
                    0,
                    0,
                    0
                ]), GPUBufferUsage.INDIRECT, `${this.mesh.nodeName} prim indirect buffer`),
                indirectOffset: 0
            }
        }

        this.pushedIndex = CustomModelRenderer.renderAble.length;
        CustomModelRenderer.setRenderAble = renderAble;
    }

    applyTransformationsToRenderData({scale, translate, rotate}: {
        scale?: [number, number, number],
        translate?: [number, number, number],
        rotate?: {
            rad: number,
            axis: [number, number, number]
        },
    }) {
        const item = CustomModelRenderer.renderAble[this.pushedIndex].renderData

        const modelMatrix = mat4.clone(item.model.data as mat4);
        if (translate) {
            mat4.translate(modelMatrix, modelMatrix, translate)
        }
        if (rotate) {
            mat4.rotate(modelMatrix, modelMatrix, rotate.rad, rotate.axis)
        }
        if (scale) {
            mat4.scale(modelMatrix, modelMatrix, scale)
        }

        updateBuffer(this.device, item.model.buffer, modelMatrix as Float32Array)
        item.model.data.set(modelMatrix)

        const normalMatrix = computeNormalMatrix3x4(modelMatrix)
        item.normal.data.set(normalMatrix)
        updateBuffer(this.device, item.normal.buffer, item.normal.data)

        if (CustomModelRenderer.renderAble[this.pushedIndex].computeShader) {
            this.ComputeBoundingSphere.findNonBusyWorker(this.mesh, (T) => {
                CustomModelRenderer.renderAble[this.pushedIndex].computeShader = {
                    ...CustomModelRenderer.renderAble[this.pushedIndex].computeShader as any,
                    frustumCulling: {
                        ...T
                    }
                }
            }, modelMatrix)
        }
    }

    public createPipeline(
        bindGroupLayout: GPUBindGroupLayout,
    ): GPURenderPipeline {

        return this.device.createRenderPipeline({
            label: this.label + " pipeline",
            layout: this.device.createPipelineLayout({bindGroupLayouts: [BaseLayer.globalBindGroup.layout, bindGroupLayout]}),
            vertex: {
                module: this.shaderModule,
                entryPoint: this.vertexEntryPoint,
                buffers: this.geom.pipelineBuffers,
            },
            fragment: {
                module: this.shaderModule,
                entryPoint: this.fragmentEntryPoint,
                targets: this.colorTarget ?? [{
                    format: CustomModelRenderer.format,
                }],
            },
            primitive: this.primitive ?? {
                topology: 'triangle-list',
                cullMode: 'back',
            },
            depthStencil: {
                depthWriteEnabled: true,
                depthCompare: 'less',
                format: 'depth24plus',
            },
        });
    }


    public createBindGroupLayout(): GPUBindGroupLayout {
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
        Object.values(this.geom.uniforms).forEach(attr => {

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

        if (this.geom.material?.color) {
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

        if (this.geom.material?.texture) {
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

        this.additionalBindLayoutItems.forEach((binding) => {
            entries.push({
                ...binding,
                binding: bindingIndex,
            });
            bindingIndex++
        })

        return this.device.createBindGroupLayout({entries, label: this.label + " bindgroup layout"});
    }

    async readBufferAsFloat32(buffer: GPUBuffer, size: number): Promise<Float32Array> {
        const readBuffer = this.device.createBuffer({
            size,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });

        const commandEncoder = this.device.createCommandEncoder();
        commandEncoder.copyBufferToBuffer(buffer, 0, readBuffer, 0, size);
        this.device.queue.submit([commandEncoder.finish()]);

        await readBuffer.mapAsync(GPUMapMode.READ);

        const arrayBuffer = readBuffer.getMappedRange();
        const floatArray = new Float32Array(arrayBuffer.slice(0));

        readBuffer.unmap();
        readBuffer.destroy();

        return floatArray;
    }

    public async createBindGroup(
        layout: GPUBindGroupLayout,
    ) {
        const entries: GPUBindGroupEntry[] = [];
        let bindingIndex = 0;


        const matrixBuffer = this.modelBuffer ?? createGPUBuffer(this.device, this.mesh.localMatrix, GPUBufferUsage.UNIFORM, `${this.label}-modelMatrix`)
        entries.push({binding: bindingIndex++, resource: {buffer: matrixBuffer}});

        const normalBuffer = this.normalBuffer ?? createGPUBuffer(this.device, this.mesh.normalMatrix, GPUBufferUsage.UNIFORM, `${this.label}-normalMatrix`)

        entries.push({binding: bindingIndex++, resource: {buffer: normalBuffer}});


        for (const [key, attr] of Object.entries(this.geom.uniforms)) {
            const ub = createGPUBuffer(this.device, attr.array, GPUBufferUsage.UNIFORM, `${this.label}-uniform-${key}`)
            entries.push({binding: bindingIndex++, resource: {buffer: ub}});
        }

        if (this.geom.material?.color) {
            const colorArray = new Float32Array(this.geom.material.color);

            const colorBuffer = createGPUBuffer(this.device, colorArray, GPUBufferUsage.UNIFORM, `${this.label}-materialColor`)

            entries.push({binding: bindingIndex++, resource: {buffer: colorBuffer}});
        }

        if (this.geom.material?.texture) {
            const imageBitmap = await createImageBitmap(new Blob([this.geom.material.texture.array]));
            const texture = this.device.createTexture({
                size: [this.geom.material.texture.size[0], this.geom.material.texture.size[1]],
                format: 'rgba8unorm',
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
            });

            this.device.queue.copyExternalImageToTexture(
                {source: imageBitmap},
                {texture: texture},
                this.geom.material.texture.size
            );

            const sampler = this.device.createSampler({
                magFilter: 'linear',
                minFilter: 'linear',
            });

            entries.push({binding: bindingIndex++, resource: texture.createView()});
            entries.push({binding: bindingIndex++, resource: sampler});
        }

        this.additionalBindGroupItems.forEach((binding) => {
            entries.push({...binding, binding: bindingIndex++});
        })

        this.renderData = {
            name: "",
            model: {
                buffer: matrixBuffer,
                data: this.modelBuffer ? await this.readBufferAsFloat32(this.modelBuffer, 16 * 4) : this.mesh.localMatrix
            },
            normal: {
                buffer: normalBuffer,
                data: this.normalBuffer ? await this.readBufferAsFloat32(this.normalBuffer, 16 * 4) : this.mesh.normalMatrix
            }
        }

        return this.device.createBindGroup({layout, entries, label: this.label + " bindgroup"})
    }
}
