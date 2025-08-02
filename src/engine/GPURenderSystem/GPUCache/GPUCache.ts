import {BaseLayer} from "../../../layers/baseLayer.ts";
import {
    bufferConvertFunc,
    CreateBindGroupEntry,
    RenderState,
    textureConvertFunc
} from "./GPUCacheTypes.ts";
import {Material, MaterialInstance} from "../../Material/Material.ts";
import {Primitive, Side} from "../../primitive/Primitive.ts";
import {HashGenerator} from "../Hasher/HashGenerator.ts";
import {makePrimitiveKey} from "../../../helpers/global.helper.ts";
import {PipelineLayoutHashItem} from "../../../renderers/modelRenderer.ts";
import {
    RenderFlag, StandardMaterialBindPoint,
} from "../MaterialDescriptorGenerator/MaterialDescriptorGeneratorTypes.ts";
import {SmartRender} from "../SmartRender/SmartRender.ts";
import {StandardMaterial} from "../../Material/StandardMaterial.ts";

export class GPUCache extends BaseLayer {
    static readonly pipelineMap: Map<string, {
        pipeline: GPURenderPipeline,
        primitives: Set<number>
    }> = new Map();
    static readonly pipelineLayoutMap: Map<number, {
        layout: GPUPipelineLayout,
        primitives: Set<number>
    }> = new Map();
    static readonly shaderModuleMap: Map<number, {
        module: GPUShaderModule,
        primitives: Set<number>
    }> = new Map();
    static readonly bindGroupLayoutMap: Map<number, {
        layout: GPUBindGroupLayout,
        primitives: Set<number>
    }> = new Map();
    static readonly materialBindGroupMap: Map<number, {
        bindGroup: GPUBindGroup,
        primitives: Set<number>
    }> = new Map();
    static readonly samplerMap: Map<number, {
        sampler: GPUSampler,
        primitives: Set<number>
    }> = new Map();
    static hasher: HashGenerator;
    static smartRenderer: SmartRender;


    constructor(device: GPUDevice, canvas: HTMLCanvasElement, ctx: GPUCanvasContext, hasher: HashGenerator) {
        super(device, canvas, ctx);
        GPUCache.hasher = hasher
        GPUCache.smartRenderer = new SmartRender(device, BaseLayer.format);
    }

    isSubset(subset: Set<number>, superset: Set<number>): boolean {
        for (const el of subset) {
            if (!superset.has(el)) return false;
        }
        return true;
    }

    public disposePrimitive(p: Primitive, side: Side): void {
        const hashes = p.primitiveHashes.get(side)
        const pSet = new Set<number>([p.id]);
        if (!hashes) {
            console.warn("The given side was not on the primitive")
            return;
        }

        hashes.samplerHash ? this.removeResource(hashes.samplerHash as never, pSet, "samplerMap") : ""
        this.removeResource(hashes.materialBindGroup as never, pSet, "materialBindGroupMap")
        this.removeResource(hashes.materialBindGroupLayout as never, pSet, "bindGroupLayoutMap")
        this.removeResource(hashes.pipelineLayout as never, pSet, "pipelineLayoutMap")
        this.removeResource(hashes.pipeline as never, pSet, "pipelineMap")
    }

    removeResource(key: never, primitives: Set<number>, targetMap: "shaderModuleMap" | "pipelineMap" | "materialBindGroupMap" | "bindGroupLayoutMap" | "pipelineLayoutMap" | "samplerMap", clearMap: undefined | boolean = undefined) {
        const resource = GPUCache[targetMap].get(key)

        if (resource) {
            if (this.isSubset(resource.primitives, primitives) || clearMap) {
                GPUCache[targetMap].delete(key);
            } else {
                primitives.forEach(primitive => {
                    resource.primitives.delete(primitive)
                })
            }
        }
    }

    changeMaterial(material: MaterialInstance) {

        material.primitives?.forEach(p => {
            const pSet = new Set<number>([p.id]);
            p.primitiveHashes.forEach(hashes => {
                if (material.descriptor.sampler) this.removeResource(hashes.samplerHash as never, pSet, "samplerMap")
                this.removeResource(hashes.shader as never, pSet, "shaderModuleMap")
                this.removeResource(hashes.pipeline as never, pSet, "pipelineMap")
                this.removeResource(hashes.materialBindGroup as never, pSet, "materialBindGroupMap")
            })
            p.material.initDescriptor(SmartRender.materialBindGroupGenerator)
        })

        material.primitives.forEach(primitive => {
            let code = '';
            if (primitive.material instanceof StandardMaterial) {
                code = SmartRender.shaderGenerator.getStandardCode(primitive)
            }
            primitive.material.shaderCode = code
        })

        const bindGroupHash = GPUCache.hasher.hashBindGroup(material.descriptor.hashEntries!)
        material.setHashes("bindGroup", bindGroupHash)
        let sampler: GPUSampler | undefined = material.resources.get(StandardMaterialBindPoint[StandardMaterialBindPoint.SAMPLER]) as GPUSampler | undefined

        if (material.descriptor.sampler) {
            const samplerHash = GPUCache.hasher.hashSampler(material.descriptor.sampler)
            material.setHashes("sampler", samplerHash)
            this.appendSampler(material.descriptor.sampler, samplerHash, Array.from(material.primitives))
            sampler = GPUCache.samplerMap.get(samplerHash)?.sampler!
        }

        const bindgroupAlreadyExists = GPUCache.materialBindGroupMap.get(bindGroupHash);

        if (!bindgroupAlreadyExists) {
            const {layout} = GPUCache.bindGroupLayoutMap.get(material.hashes.bindGroupLayout.new!)!
            const entries: GPUBindGroupEntry[] = []

            material.descriptor.entries?.forEach(entry => {
                entries.push({
                    binding: entry.bindingPoint,
                    resource: entry.textureDescriptor ?
                        entry.textureDescriptor.texture.createView(entry.textureDescriptor.viewDescriptor)
                        : {buffer: entry.buffer!}
                })
            })
            if (sampler) {
                entries.push({
                    binding: StandardMaterialBindPoint.SAMPLER,
                    resource: sampler
                })
            }

            const bindGroup = GPUCache.device.createBindGroup({
                entries,
                layout
            })
            material.bindGroup = bindGroup

            GPUCache.materialBindGroupMap.set(bindGroupHash, {
                bindGroup,
                primitives: new Set(Array.from(material.primitives).map(p => p.id))
            })
        } else {
            for (let i = 0; i < material.primitives.size; i++) {
                bindgroupAlreadyExists.primitives.add(Array.from(material.primitives)[i].id)
            }
        }


        const shaderCodeHash = GPUCache.hasher.hashShaderModule(material.shaderCode!)
        material.setHashes("shader", shaderCodeHash)
        this.appendShaderModule(material.shaderCode!, shaderCodeHash, Array.from(material.primitives))

        material.primitives.forEach(primitive => {
            primitive.sides.forEach(side => {
                const hashes = primitive.primitiveHashes.get(side)!;
                const pipelineDescriptor = primitive.pipelineDescriptors.get(side)!
                primitive.setPrimitiveHashes({
                    shader: shaderCodeHash,
                    pipelineLayout: hashes.pipelineLayout,
                    samplerHash: primitive.material.hashes.sampler.new,
                    materialBindGroupLayout: primitive.material.hashes.bindGroupLayout.new!,
                    materialBindGroup: bindGroupHash,
                    pipeline: hashes.pipeline,
                }, side)
                this.appendPipeline(pipelineDescriptor, hashes.pipeline, hashes.pipelineLayout, shaderCodeHash, primitive)
                const pipeline = GPUCache.pipelineMap.get(`${hashes.pipelineLayout}${shaderCodeHash}${hashes.pipeline}`)?.pipeline!
                primitive.setPipeline(side, pipeline)
            })
        })
    }

    changePipeline(primitive: Primitive) {
        let hashes = Array.from(primitive.primitiveHashes.entries())[0][1]
        GPUCache.smartRenderer.setPipelineDescriptors([primitive.sceneObject])
        primitive.primitiveHashes.clear()
        primitive.sides.forEach(side => {
            primitive.setPrimitiveHashes(hashes, side)
        })

        primitive.primitiveHashes.forEach((hashes, side) => {
            this.removeResource(hashes.pipeline as never, new Set<number>([primitive.id]), "pipelineMap")
            const pipelineHash = Array.from(this.createPipelineHashes(
                new Map([[primitive.id, hashes.shader]]),
                new Map([[primitive.id, {
                    sceneObject: primitive.sceneObject,
                    hash: hashes.pipelineLayout,
                    primitive: primitive
                }]]),
            ))[0][1]
            primitive.pipelines.set(side, GPUCache.pipelineMap.get(`${hashes.pipelineLayout}${hashes.shader}${pipelineHash}`)?.pipeline!)
        })
    }

    createGeometryLayoutHashes(primitives: Primitive[]) {
        const layoutHashes = new Map<number, number>();
        primitives.forEach((prim) => {
            const layoutEntries = prim.geometry.descriptors.layout;
            if (!layoutEntries) throw new Error(`geometry layout entries are not set at primitive with id : ${prim.id}`)
            const hash = GPUCache.hasher.hashBindGroupLayout(layoutEntries)
            this.appendBindGroupLayout(layoutEntries, hash, prim)
            layoutHashes.set(prim.id, hash)
            prim.geometry.setBindGroupLayoutHash(hash)
        })

        return layoutHashes
    }

    createSamplerHash(material: Material) {
        const samplerHash = GPUCache.hasher.hashSampler(material.descriptor.sampler!)
        material.setHashes("sampler", samplerHash)
        this.appendSampler(material.descriptor.sampler!, samplerHash, Array.from(material.primitives))
    }

    async createMaterialHashes(materials: MaterialInstance[], layoutHash: number | undefined = undefined) {
        const materialHashes = new Map<number, {
            layout: number,
            bindGroup: number
        }>();
        for (let i = 0; i < materials.length; i++) {
            const materialItem = materials[i];
            if (!materialItem.descriptor.hashEntries) throw new Error(`${materialItem.name} material has no descriptor for hash entries`)
            if (!materialItem.descriptor.layout) throw new Error(`${materialItem.name} material has no descriptor for layout`)
            const materialHash = GPUCache.hasher.hashBindGroup(materialItem.descriptor.hashEntries);
            const materialLayoutHash = layoutHash ?? GPUCache.hasher.hashBindGroupLayout(materialItem.descriptor.layout)


            materialItem.setHashes("bindGroupLayout", materialLayoutHash)
            materialItem.setHashes("bindGroup", materialHash)
            const materialPrimitives: Primitive[] = [];

            if (materialItem.primitives.size === 0) throw new Error(`${materialItem.name} material has no primitive`)
            materialItem.primitives.forEach((primitive) => {
                materialPrimitives.push(primitive)
                materialHashes.set(primitive.id, {
                    layout: materialLayoutHash,
                    bindGroup: materialHash
                })
                this.appendBindGroupLayout(
                    materialItem.descriptor.layout!,
                    materialLayoutHash,
                    primitive
                );
            })
            if (materialItem.descriptor.sampler) {
                this.createSamplerHash(materialItem)
            }
            await this.appendMaterialBindGroup(
                materialItem,
                materialPrimitives
            );
        }

        return materialHashes
    }

    createShaderCodeHashes(primitives: Primitive[]) {
        const shaderCodesHashes = new Map<number, number>();
        for (let i = 0; i < primitives.length; i++) {
            const item = primitives[i];
            if (!item.material.shaderCode) throw new Error(`shader code not set on primitive with id : ${primitives[i].id}}`);
            const hash = GPUCache.hasher.hashShaderModule(item.material.shaderCode)


            shaderCodesHashes.set(item.id, hash)
            item.material.setHashes("shader", hash)
            this.appendShaderModule(item.material.shaderCode, hash, [item])
        }

        return shaderCodesHashes
    }

    createPipelineLayoutHashes(primitives: Primitive[], materialLayoutHashes: Map<number, {
        layout: number,
        bindGroup: number
    }>, geometryLayoutHashes: Map<number, number>) {
        const pipelineLayoutsHashes = new Map<number, PipelineLayoutHashItem>();

        for (let i = 0; i < primitives.length; i++) {
            const primitive = primitives[i];

            let materialLayout = materialLayoutHashes.get(primitive.id)?.layout
            let geometryLayout = geometryLayoutHashes.get(primitive.id)
            if (!materialLayoutHashes) throw new Error(`primitive with id ${primitive.id}  has no layout hash set on material`)
            if (!geometryLayout) throw new Error(`primitive with id ${primitive.id}  has no layout hash set on geometry`)

            const hash = GPUCache.hasher.hashPipelineLayout(
                materialLayout!,
                geometryLayout!
            )
            this.appendPipelineLayout(
                hash,
                materialLayout!,
                geometryLayout!,
                primitive
            )
            pipelineLayoutsHashes.set(primitive.id, {
                primitive: primitive,
                hash
            });
        }

        return pipelineLayoutsHashes
    }

    createGeometryBindGroupMaps(primitives: Primitive[]) {
        const geometryBindGroupMaps = new Map<number, (GPUBindGroupEntry & {
            name?: "model" | "normal"
        })[]>();
        primitives.forEach((item) => {
            if (!item.geometry.descriptors.bindGroup) throw new Error(`Primitive with Id ${item.id} has no bindgroup descriptor set on geometry`)
            geometryBindGroupMaps.set(item.id, item.geometry.descriptors.bindGroup)

        })

        return geometryBindGroupMaps
    }

    createPipelineHashes(shaderCodesHashes: Map<number, number>, pipelineLayoutsHashes: Map<number, PipelineLayoutHashItem>) {
        const pipelineHashes = new Map<string, number>();
        pipelineLayoutsHashes.forEach((item) => {
            const shaderCodeHash = shaderCodesHashes.get(item.primitive.id)
            if (!shaderCodeHash) throw new Error(`Shader code has is not set primitive ${item.primitive.id}`)
            if (item.primitive.sides.length === 0) throw new Error(`There is no side set on primitive with id ${item.primitive.id}`)
            item.primitive.sides.forEach((side) => {
                const pipelineDescriptor = item.primitive.pipelineDescriptors.get(side)
                if (!pipelineDescriptor) throw new Error(`Primitive ${item.primitive.id} has no corresponding pipeline descriptor for ${side} side`)
                const hash = GPUCache.hasher.hashPipeline(pipelineDescriptor, item.hash, item.primitive.vertexBufferDescriptors)
                this.appendPipeline(pipelineDescriptor, hash, item.hash, shaderCodeHash!, item.primitive)
                pipelineHashes.set(makePrimitiveKey(item.primitive.id, side), hash)
            })
        })
        return pipelineHashes
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
                primitives: new Set(primitives.map(prim => prim.id))
            });
        } else {
            for (let i = 0; i < primitives.length; i++) {
                alreadyExists.primitives.add(primitives[i].id)
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
        const alreadyExists = GPUCache.pipelineMap.get(`${pipelineLayoutHash}${shaderModuleHash}${pipelineHash}`);
        if (!alreadyExists) {
            const pipelineLayout = GPUCache.pipelineLayoutMap.get(pipelineLayoutHash)?.layout as GPUPipelineLayout;
            const shaderModule = GPUCache.shaderModuleMap.get(shaderModuleHash)?.module as GPUShaderModule;

            GPUCache.pipelineMap.set(`${pipelineLayoutHash}${shaderModuleHash}${pipelineHash}`, {
                pipeline: BaseLayer.device.createRenderPipeline({
                    primitive: renderState.primitive,
                    vertex: {
                        entryPoint: 'vs',
                        module: shaderModule,
                        buffers: primitive.vertexBufferDescriptors,
                        constants: renderState.vertexConstants
                    },
                    fragment: {
                        entryPoint: 'fs',
                        module: shaderModule,
                        targets: renderState.targets,
                        constants: renderState.fragmentConstants
                    },
                    depthStencil: renderState.depthStencil,
                    layout: pipelineLayout,
                }),
                primitives: new Set([primitive.id])
            });
        } else {
            alreadyExists.primitives.add(primitive.id)
        }
    }

    public appendPipelineLayout(pipelineLayoutHash: number, materialLayoutHash: number, geometryLayoutHash: number, primitive: Primitive) {
        const alreadyExists = GPUCache.pipelineLayoutMap.get(pipelineLayoutHash);


        if (!alreadyExists) {
            const materialLayout = GPUCache.bindGroupLayoutMap.get(materialLayoutHash)?.layout as GPUBindGroupLayout;
            const geometryLayout = GPUCache.bindGroupLayoutMap.get(geometryLayoutHash)?.layout as GPUBindGroupLayout;
            GPUCache.pipelineLayoutMap.set(pipelineLayoutHash, {
                layout: BaseLayer.device.createPipelineLayout({
                    label: `pipeline layout ${pipelineLayoutHash}`,
                    bindGroupLayouts: [GPUCache.globalBindGroupLayout, materialLayout, geometryLayout]
                }),
                primitives: new Set([primitive.id])
            })
        } else {
            alreadyExists.primitives.add(primitive.id)
        }
    }

    public appendShaderModule(code: string, shaderHash: number, primitive: Primitive[]) {
        const alreadyExists = GPUCache.shaderModuleMap.get(shaderHash);
        if (!alreadyExists) {
            GPUCache.shaderModuleMap.set(shaderHash, {
                module: BaseLayer.device.createShaderModule({
                    label: `module ${shaderHash}`,
                    code
                }),
                primitives: new Set(primitive.map(prim => prim.id))
            })
        } else {
            primitive.forEach(prim => {
                alreadyExists.primitives.add(prim.id)
            })
        }
    }

    public appendBindGroupLayout(entries: GPUBindGroupLayoutEntry[], layoutHash: number, primitive: Primitive | Primitive[]) {

        const alreadyExists = GPUCache.bindGroupLayoutMap.get(layoutHash);
        if (!alreadyExists) {
            GPUCache.bindGroupLayoutMap.set(layoutHash, {
                layout: BaseLayer.device.createBindGroupLayout({
                    label: `layout ${layoutHash}`,
                    entries
                }),
                primitives: new Set(
                    primitive instanceof Primitive ? [primitive.id] :
                        primitive.map(primitive => primitive.id)
                )
            })
        } else {
            if (primitive instanceof Primitive) {
                GPUCache.bindGroupLayoutMap.get(layoutHash)!.primitives.add(primitive.id)
            } else {
                primitive.forEach(primitive => GPUCache.bindGroupLayoutMap.get(layoutHash)!.primitives.add(primitive.id))
            }
        }
    }

    protected async getEntries(material: MaterialInstance) {
        if (!material.descriptor.entries) throw new Error(`${material.name} has no descriptor for entries`)
        const entries: GPUBindGroupEntry[] = await Promise.all(material.descriptor.entries.map(async (entry) => {
            if (entry.textureDescriptor) {

                return {
                    binding: entry.bindingPoint,
                    resource: entry.textureDescriptor.texture.createView(entry.textureDescriptor.viewDescriptor),
                }
            } else if (entry.buffer) {

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
                    convertedData = await (conversion as textureConvertFunc)(BaseLayer.device, entry.typedArray.size, data, entry.typedArray.format);
                } else {
                    throw new Error(`Unknown conversionType`);
                }
                entry.materialResourcesKey ? material.resources.set(entry.materialResourcesKey, convertedData) : ""

                if (convertedData instanceof GPUTexture) {
                    "renderFlag" in entry.typedArray ? material.resources.set(RenderFlag[entry.typedArray.renderFlag], convertedData) : ""
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
        if (material.hashes.sampler.new) {
            material.resources.set(StandardMaterialBindPoint[StandardMaterialBindPoint.SAMPLER], GPUCache.samplerMap.get(material.hashes.sampler.new)?.sampler!)

            entries.push({
                binding: StandardMaterialBindPoint.SAMPLER,
                resource: GPUCache.samplerMap.get(material.hashes.sampler.new)?.sampler!
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
        const layout = layoutList.get(layoutHash)?.layout;
        const entries = await this.getEntries(material);

        if (!layout) throw new Error(`${material.name} material has no layout descriptor`)
        return BaseLayer.device.createBindGroup({
            label: `bindGroup ${bindGroupHash}`,
            entries,
            layout
        })
    }

    public async appendMaterialBindGroup(
        material: MaterialInstance,
        primitives: Primitive[]
    ) {
        const alreadyExists = GPUCache.materialBindGroupMap.get(material.hashes.bindGroup.new!);
        if (!alreadyExists) {
            const bindGroup = await this.createBindGroup({
                material,
                layoutList: GPUCache.bindGroupLayoutMap,
                layoutHash: material.hashes.bindGroupLayout.new!,
                bindGroupHash: material.hashes.bindGroup.new!
            })
            GPUCache.materialBindGroupMap.set(material.hashes.bindGroup.new!, {
                bindGroup,
                primitives: new Set(primitives.map(p => p.id))
            })
        } else {
            for (let i = 0; i < primitives.length; i++) {
                alreadyExists.primitives.add(primitives[i].id)
            }
        }
    }

    public getResource(hash: number | string, targetMap: "shaderModuleMap" | "pipelineMap" | "materialBindGroupMap" | "bindGroupLayoutMap" | "pipelineLayoutMap" | "samplerMap") {
        return GPUCache[targetMap].get(hash as never);
    }

    public getRenderSetup(pipelineHash: number, pipelineLayout: number, materialBindGroupHash: number, geometryBindGroupLayoutHash: number, shaderCodeHash: number) {
        return {
            pipeline: GPUCache.pipelineMap.get(`${pipelineLayout}${shaderCodeHash}${pipelineHash}`)?.pipeline!,
            pipelineLayout: (GPUCache.pipelineLayoutMap.get(pipelineLayout))?.layout!,
            materialBindGroup: (GPUCache.materialBindGroupMap.get(materialBindGroupHash))?.bindGroup!,
            geometryBindGroupLayout: (GPUCache.bindGroupLayoutMap.get(geometryBindGroupLayoutHash))?.layout!,
            shaderModule: (GPUCache.shaderModuleMap.get(shaderCodeHash))?.module!,
        }
    }
}