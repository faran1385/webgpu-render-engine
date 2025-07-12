import {BaseLayer} from "../../../layers/baseLayer.ts";
import {
    bufferConvertFunc,
    CreateBindGroupEntry,
    RenderState,
    textureConvertFunc
} from "./GPUCacheTypes.ts";
import {Material} from "../../Material/Material.ts";
import {Primitive} from "../../primitive/Primitive.ts";
import {HashGenerator} from "../Hasher/HashGenerator.ts";

export class GPUCache extends BaseLayer {
    static readonly pipelineMap: Map<string, {
        pipeline: GPURenderPipeline,
        primitives: Set<Primitive>
    }> = new Map();
    static readonly pipelineLayoutMap: Map<number, {
        layout: GPUPipelineLayout,
        primitives: Set<Primitive>
    }> = new Map();
    static readonly shaderModuleMap: Map<number, {
        module: GPUShaderModule,
        primitives: Set<Primitive>
    }> = new Map();
    static readonly bindGroupLayoutMap: Map<number, {
        layout: GPUBindGroupLayout,
        primitives: Set<Primitive>
    }> = new Map();
    static readonly materialBindGroupMap: Map<number, {
        bindGroup: GPUBindGroup,
        primitives: Set<Primitive>
    }> = new Map();
    static readonly samplerMap: Map<number, {
        sampler: GPUSampler,
        primitives: Set<Primitive>
    }> = new Map();
    // Reverse dependency lookup
    static readonly bindGroupLayoutToBindGroups = new Map<number, Set<number>>();
    static readonly bindGroupLayoutToPipelineLayouts = new Map<number, Set<number>>();
    static readonly pipelineLayoutToPipelines = new Map<number, Set<number>>();
    static hasher: HashGenerator;


    constructor(device: GPUDevice, canvas: HTMLCanvasElement, ctx: GPUCanvasContext, hasher: HashGenerator) {
        super(device, canvas, ctx);
        GPUCache.hasher = hasher
    }

    isSubset(subset: Set<Primitive>, superset: Set<Primitive>): boolean {
        for (const el of subset) {
            if (!superset.has(el)) return false;
        }
        return true;
    }


    public changeBindGroupEntries({material, oldLayout}: {
        material: Material,
        oldLayout: number
    }) {
        for (let primitive of material.primitives) {
            const geometry = primitive.geometry;
            if (!geometry.hashes.bindGroupLayout) throw new Error("Geometry Layout Hash Is Null")

            // bindGroupLayout
            const layout = GPUCache.bindGroupLayoutMap.get(oldLayout)!
            if (this.isSubset(layout.primitives, material.primitives)) {
                GPUCache.bindGroupLayoutMap.delete(oldLayout);
            } else {
                material.primitives.forEach(primitive => {
                    layout.primitives.delete(primitive)
                })
            }

            // bindGroup
            const bindGroupsHashes = GPUCache.bindGroupLayoutToBindGroups.get(oldLayout)!;
            bindGroupsHashes.forEach(hash => {
                const item = GPUCache.materialBindGroupMap.get(hash)!;
                if (this.isSubset(item.primitives, material.primitives)) {
                    GPUCache.materialBindGroupMap.delete(hash)
                } else {
                    material.primitives.forEach(primitive => {
                        item.primitives.delete(primitive)
                    })
                }
            })

            // pipelineLayouts
            const pipelineLayoutHashes = GPUCache.bindGroupLayoutToPipelineLayouts.get(oldLayout)!;
            pipelineLayoutHashes.forEach(hash => {
                const item = GPUCache.pipelineLayoutMap.get(hash)!;
                if (this.isSubset(item.primitives, material.primitives)) {
                    GPUCache.pipelineLayoutMap.delete(hash)
                } else {
                    material.primitives.forEach(primitive => {
                        item.primitives.delete(primitive)
                    })
                }
            })
            // pipeline
            pipelineLayoutHashes.forEach(pipelineLayoutHash => {
                const pipelineHashes = GPUCache.pipelineLayoutToPipelines.get(pipelineLayoutHash)!
                pipelineHashes.forEach(pipelineHash => {
                    const item = GPUCache.pipelineMap.get(`${pipelineLayoutHash}${pipelineHash}`)!
                    if (this.isSubset(item.primitives, material.primitives)) {
                        GPUCache.pipelineMap.delete(`${pipelineLayoutHash}${pipelineHash}`)
                    } else {
                        material.primitives.forEach(primitive => {
                            item.primitives.delete(primitive)
                        })
                    }
                })
            })
        }
    }

    public appendSampler(
        samplerDescriptor: GPUSamplerDescriptor,
        samplerHash: number,
        primitives: Primitive[]
    ) {
        const alreadyExists = GPUCache.samplerMap.get(samplerHash);
        if (!alreadyExists) {
            GPUCache.samplerMap.set(samplerHash, {
                sampler: GPUCache.device.createSampler(samplerDescriptor),
                primitives: new Set(primitives)
            });
        } else {
            for (let i = 0; i < primitives.length; i++) {
                alreadyExists.primitives.add(primitives[i])
            }
        }
    }

    public appendPipeline(
        renderState: RenderState,
        pipelineHash: number,
        pipelineLayoutHash: number,
        shaderModuleHash: number,
        primitive: Primitive
    ) {
        const alreadyExists = GPUCache.pipelineMap.get(`${pipelineLayoutHash}${pipelineHash}`);
        if (!alreadyExists) {
            const pipelineLayout = GPUCache.pipelineLayoutMap.get(pipelineLayoutHash)?.layout as GPUPipelineLayout;
            const shaderModule = GPUCache.shaderModuleMap.get(shaderModuleHash)?.module as GPUShaderModule;
            GPUCache.pipelineMap.set(`${pipelineLayoutHash}${pipelineHash}`, {
                pipeline: BaseLayer.device.createRenderPipeline({
                    primitive: renderState.primitive,
                    vertex: {
                        entryPoint: 'vs',
                        module: shaderModule,
                        buffers: primitive.vertexBufferDescriptors
                    },
                    fragment: {
                        entryPoint: 'fs',
                        module: shaderModule,
                        targets: renderState.targets
                    },
                    depthStencil: renderState.depthStencil,
                    layout: pipelineLayout,
                }),
                primitives: new Set([primitive])
            });
            GPUCache.pipelineLayoutToPipelines.set(pipelineLayoutHash, new Set([pipelineHash]));
        } else {
            alreadyExists.primitives.add(primitive)
            GPUCache.pipelineLayoutToPipelines.get(pipelineLayoutHash)!.add(pipelineHash);

        }

    }

    public appendPipelineLayout(pipelineLayoutHash: number, materialLayoutHash: number, geometryLayoutHash: number, primitive: Primitive) {
        const alreadyExists = GPUCache.pipelineLayoutMap.get(pipelineLayoutHash);

        for (const layoutHash of [materialLayoutHash, geometryLayoutHash]) {
            if (!GPUCache.bindGroupLayoutToPipelineLayouts.has(layoutHash)) {
                GPUCache.bindGroupLayoutToPipelineLayouts.set(layoutHash, new Set([pipelineLayoutHash]));
            } else {
                GPUCache.bindGroupLayoutToPipelineLayouts.get(layoutHash)!.add(pipelineLayoutHash);
            }
        }


        if (!alreadyExists) {
            const materialLayout = GPUCache.bindGroupLayoutMap.get(materialLayoutHash)?.layout as GPUBindGroupLayout;
            const geometryLayout = GPUCache.bindGroupLayoutMap.get(geometryLayoutHash)?.layout as GPUBindGroupLayout;
            GPUCache.pipelineLayoutMap.set(pipelineLayoutHash, {
                layout: BaseLayer.device.createPipelineLayout({
                    label: `pipeline layout ${pipelineLayoutHash}`,
                    bindGroupLayouts: [GPUCache.globalBindGroup.layout, materialLayout, geometryLayout]
                }),
                primitives: new Set([primitive])
            })
        } else {
            alreadyExists.primitives.add(primitive)
        }
    }

    public appendShaderModule(code: string, shaderHash: number, primitive: Primitive) {
        const alreadyExists = GPUCache.shaderModuleMap.get(shaderHash);
        if (!alreadyExists) {
            GPUCache.shaderModuleMap.set(shaderHash, {
                module: BaseLayer.device.createShaderModule({
                    label: `module ${shaderHash}`,
                    code
                }),
                primitives: new Set([primitive])
            })
        } else {
            alreadyExists.primitives.add(primitive)
        }
    }

    public appendBindGroupLayout(entries: GPUBindGroupLayoutEntry[], layoutHash: number, primitive: Primitive) {

        const alreadyExists = GPUCache.bindGroupLayoutMap.get(layoutHash);
        if (!alreadyExists) {
            GPUCache.bindGroupLayoutMap.set(layoutHash, {
                layout: BaseLayer.device.createBindGroupLayout({
                    label: `layout ${layoutHash}`,
                    entries
                }),
                primitives: new Set([primitive])
            })
        } else {
            GPUCache.bindGroupLayoutMap.get(layoutHash)!.primitives.add(primitive)
        }
    }

    protected async getEntries(material: Material) {

        const entries: GPUBindGroupEntry[] = await Promise.all(material.descriptor.entries.map(async (entry) => {

            if (entry.texture) {
                material.resources.set(entry.materialKey, entry.texture)
                return {
                    binding: entry.bindingPoint,
                    resource: entry.texture.createView(),
                }
            } else if (entry.buffer) {

                material.resources.set(entry.materialKey, entry.buffer)
                return {
                    binding: entry.bindingPoint,
                    resource: {
                        buffer: entry.buffer
                    }
                }
            } else if (entry.typedArray) {
                const {conversion, data} = entry.typedArray;

                let convertedData: GPUBuffer | GPUTexture;


                if ("usage" in entry.typedArray) {
                    convertedData = (conversion as bufferConvertFunc)(BaseLayer.device, data, entry.typedArray.usage, entry.typedArray.label);
                } else if ("size" in entry.typedArray) {
                    if (!entry.typedArray.size) throw new Error("Size is required for texture creation");
                    if (!entry.typedArray.size) throw new Error("Size is required for texture creation");
                    convertedData = await (conversion as textureConvertFunc)(BaseLayer.device, entry.typedArray.size, data);
                } else {
                    throw new Error(`Unknown conversionType`);
                }
                material.resources.set(entry.materialKey, convertedData)

                if (convertedData instanceof GPUTexture) {
                    return {
                        binding: entry.bindingPoint,
                        resource: convertedData.createView()
                    }
                } else {
                    return {
                        binding: entry.bindingPoint,
                        resource: {
                            buffer: convertedData
                        }
                    }
                }
            } else {
                throw new Error("in order to create bindGroup you need to specify an texture | sampler | typedArray | buffer")
            }
        }))
        if (material.hashes.sampler) {
            material.resources.set("Sampler", GPUCache.samplerMap.get(material.hashes.sampler)?.sampler!)

            entries.push({
                binding: material.samplerInfo.bindPoint!,
                resource: GPUCache.samplerMap.get(material.hashes.sampler)?.sampler!
            })
        }
        return entries
    }

    protected async createBindGroup({
                                        layoutList,
                                        material,
                                        layoutHash,
                                        bindGroupHash,
                                    }: CreateBindGroupEntry) {
        const layout = layoutList.get(layoutHash)?.layout as GPUBindGroupLayout;
        const entries = await this.getEntries(material);

        if (!GPUCache.bindGroupLayoutToBindGroups.has(layoutHash)) {
            GPUCache.bindGroupLayoutToBindGroups.set(layoutHash, new Set([bindGroupHash]));
        } else {
            GPUCache.bindGroupLayoutToBindGroups.get(layoutHash)?.add(bindGroupHash)

        }
        GPUCache.bindGroupLayoutToBindGroups.get(layoutHash)!.add(bindGroupHash);


        return BaseLayer.device.createBindGroup({
            label: `bindGroup ${bindGroupHash}`,
            entries,
            layout
        })
    }

    public async appendMaterialBindGroup(
        material: Material,
        bindGroupHash: number, layoutHash: number,
        primitives: Primitive[]
    ) {
        const alreadyExists = GPUCache.materialBindGroupMap.get(bindGroupHash);
        if (!alreadyExists) {
            const bindGroup = await this.createBindGroup({
                material,
                layoutList: GPUCache.bindGroupLayoutMap,
                layoutHash,
                bindGroupHash
            })
            GPUCache.materialBindGroupMap.set(bindGroupHash, {
                bindGroup,
                primitives: new Set(primitives)
            })
        } else {
            for (let i = 0; i < primitives.length; i++) {
                alreadyExists.primitives.add(primitives[i])
            }
        }
    }

    public getRenderSetup(pipelineHash: number, pipelineLayout: number, materialBindGroupHash: number, geometryBindGroupLayoutHash: number, shaderCodeHash: number) {
        return {
            pipeline: GPUCache.pipelineMap.get(`${pipelineLayout}${pipelineHash}`)?.pipeline as GPURenderPipeline,
            pipelineLayout: (GPUCache.pipelineLayoutMap.get(pipelineLayout))?.layout as GPUPipelineLayout,
            materialBindGroup: (GPUCache.materialBindGroupMap.get(materialBindGroupHash))?.bindGroup as GPUBindGroup,
            geometryBindGroupLayout: (GPUCache.bindGroupLayoutMap.get(geometryBindGroupLayoutHash))?.layout as GPUBindGroupLayout,
            shaderModule: (GPUCache.shaderModuleMap.get(shaderCodeHash))?.module as GPUShaderModule,
        }
    }
}