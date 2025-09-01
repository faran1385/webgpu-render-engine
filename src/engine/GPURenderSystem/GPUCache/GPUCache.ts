import {BaseLayer} from "../../../layers/baseLayer.ts";
import {RenderState} from "./GPUCacheTypes.ts";
import {MaterialInstance} from "../../Material/Material.ts";
import {Primitive, Side} from "../../primitive/Primitive.ts";
import {createGPUBuffer, makePrimitiveKey} from "../../../helpers/global.helper.ts";
import {PipelineLayoutHashItem} from "../../../renderers/modelRenderer.ts";
import {SmartRender} from "../SmartRender/SmartRender.ts";
import {TextureGenerator} from "../../texture/textureGenerator.ts";

export class GPUCache {
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
    static personalTextureArrayCache = new Map<string, GPUTexture>()
    static globalTextureArrayCache = new Map<string, GPUTexture>()
    static textureLocationCache = new Map<number, {
        textureArrayKey: string,
        isGlobal: boolean,
        width: number,
        height: number,
        layer: number
    }>()
    static visualTexturesCache = new Map<number, GPUTexture>()
    static smartRenderer: SmartRender;
    static textureGenerator: TextureGenerator;


    constructor() {
        GPUCache.smartRenderer = new SmartRender();
        GPUCache.textureGenerator = new TextureGenerator()
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

        this.removeResource(hashes.pipelineLayout as never, pSet, "pipelineLayoutMap")
        this.removeResource(hashes.pipeline as never, pSet, "pipelineMap")
    }


    removeResource(key: never, primitives: Set<number>, targetMap: "shaderModuleMap" | "pipelineMap" | "bindGroupLayoutMap" | "pipelineLayoutMap", clearMap: undefined | boolean = undefined) {
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
                new Map([[primitive.id, [hashes.shader.fragment, hashes.shader.vertex]]]),
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
            const hash = BaseLayer.hasher.hashBindGroupLayout(layoutEntries)
            this.appendBindGroupLayout(layoutEntries, hash, [prim])
            layoutHashes.set(prim.id, hash)
            prim.geometry.setHashes("bindGroupLayout", hash)
        })

        return layoutHashes
    }

    async createMaterialHashes(materials: MaterialInstance[]) {

        for (let i = 0; i < materials.length; i++) {
            const materialItem = materials[i];
            if (materialItem.primitives.size === 0) throw new Error(`${materialItem.name} material has no primitive`)
            materialItem.bindGroup = await this.appendMaterialBindGroup(
                materialItem
            );
        }

    }

    createShaderCodeHashes(primitives: Primitive[], hashGeo: boolean) {
        const shaderCodesHashes = new Map<number, [number, number]>();
        for (let i = 0; i < primitives.length; i++) {
            const item = primitives[i];
            if (!item.material.shaderCode) throw new Error(`given primitive with id : ${primitives[i].id}} has no shader code on material`);
            const matHash = BaseLayer.hasher.hashShaderModule(item.material.shaderCode)
            this.appendShaderModule(item.material.shaderCode, matHash, [item])

            if (hashGeo) {
                if (!item.geometry.shaderCode) throw new Error(`given primitive with id : ${primitives[i].id}} has no shader code on geometry`);
                const geoHash = BaseLayer.hasher.hashShaderModule(item.geometry.shaderCode)
                this.appendShaderModule(item.geometry.shaderCode, geoHash, [item])

                shaderCodesHashes.set(item.id, [matHash, geoHash])
            } else {
                shaderCodesHashes.set(item.id, [matHash, Array.from(item.primitiveHashes)[0][1].shader.vertex])
            }

        }

        return shaderCodesHashes
    }

    createPipelineLayoutHashes(primitives: Primitive[], geometryLayoutHashes: Map<number, number>) {
        const pipelineLayoutsHashes = new Map<number, PipelineLayoutHashItem>();

        for (let i = 0; i < primitives.length; i++) {
            const primitive = primitives[i];

            let materialLayout = primitive.material.hashes.bindGroupLayout.new
            let geometryLayout = geometryLayoutHashes.get(primitive.id)
            if (!materialLayout) throw new Error(`${primitive.material.name} does not have material layout hash`)
            if (!geometryLayout) throw new Error(`primitive with id ${primitive.id}  has no layout hash set on geometry`)

            const hash = BaseLayer.hasher.hashPipelineLayout(
                materialLayout!,
                geometryLayout!
            )
            this.appendPipelineLayout(
                hash,
                primitive.material,
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

    createPipelineHashes(shaderCodesHashes: Map<number, [number, number]>, pipelineLayoutsHashes: Map<number, PipelineLayoutHashItem>) {
        const pipelineHashes = new Map<string, number>();
        pipelineLayoutsHashes.forEach((item) => {
            const shaderHashes = shaderCodesHashes.get(item.primitive.id)
            if (!shaderHashes) throw new Error(`Shader code has is not set primitive ${item.primitive.id}`)
            if (item.primitive.sides.length === 0) throw new Error(`There is no side set on primitive with id ${item.primitive.id}`)

            item.primitive.sides.forEach((side) => {
                const pipelineDescriptor = item.primitive.pipelineDescriptors.get(side)
                if (!pipelineDescriptor) throw new Error(`Primitive ${item.primitive.id} has no corresponding pipeline descriptor for ${side} side`)

                const hash = BaseLayer.hasher.hashPipeline(pipelineDescriptor, item.hash, item.primitive.vertexBufferDescriptors)
                this.appendPipeline(pipelineDescriptor, hash, item.hash, shaderHashes!, item.primitive)
                pipelineHashes.set(makePrimitiveKey(item.primitive.id, side), hash)
            })
        })
        return pipelineHashes
    }


    public appendPipeline(
        renderState: RenderState,
        pipelineHash: number,
        pipelineLayoutHash: number,
        shaderModuleHash: [number, number],
        primitive: Primitive
    ) {
        const alreadyExists = GPUCache.pipelineMap.get(`${pipelineLayoutHash}${shaderModuleHash[0]}${shaderModuleHash[1]}${pipelineHash}`);
        if (!alreadyExists) {
            const pipelineLayout = GPUCache.pipelineLayoutMap.get(pipelineLayoutHash)?.layout as GPUPipelineLayout;
            const fragmentShaderModule = GPUCache.shaderModuleMap.get(shaderModuleHash[0])?.module as GPUShaderModule;
            const vertexShaderModule = GPUCache.shaderModuleMap.get(shaderModuleHash[1])?.module as GPUShaderModule;
            GPUCache.pipelineMap.set(`${pipelineLayoutHash}${shaderModuleHash[0]}${shaderModuleHash[1]}${pipelineHash}`, {
                pipeline: BaseLayer.device.createRenderPipeline({
                    primitive: renderState.primitive,
                    vertex: {
                        entryPoint: 'vs',
                        module: vertexShaderModule,
                        buffers: primitive.vertexBufferDescriptors,
                        constants: renderState.vertexConstants
                    },
                    fragment: {
                        entryPoint: 'fs',
                        module: fragmentShaderModule,
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

    public appendPipelineLayout(pipelineLayoutHash: number, material: MaterialInstance, geometryLayoutHash: number, primitive: Primitive) {
        const alreadyExists = GPUCache.pipelineLayoutMap.get(pipelineLayoutHash);


        if (!alreadyExists) {
            const geometryLayout = GPUCache.bindGroupLayoutMap.get(geometryLayoutHash)?.layout as GPUBindGroupLayout;
            GPUCache.pipelineLayoutMap.set(pipelineLayoutHash, {
                layout: BaseLayer.device.createPipelineLayout({
                    label: `pipeline layout ${pipelineLayoutHash}`,
                    bindGroupLayouts: [BaseLayer.bindGroupLayouts.globalBindGroupLayout, material.bindGroupLayout, geometryLayout]
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

    public appendBindGroupLayout(entries: GPUBindGroupLayoutEntry[], layoutHash: number, primitive: Primitive[]) {

        const alreadyExists = GPUCache.bindGroupLayoutMap.get(layoutHash);
        if (!alreadyExists) {
            GPUCache.bindGroupLayoutMap.set(layoutHash, {
                layout: BaseLayer.device.createBindGroupLayout({
                    label: `layout ${layoutHash}`,
                    entries
                }),
                primitives: new Set(primitive.map(primitive => primitive.id))
            })
        } else {
            primitive.forEach(primitive => GPUCache.bindGroupLayoutMap.get(layoutHash)!.primitives.add(primitive.id))
        }
    }


    protected async getEntries(material: MaterialInstance) {
        if (!material.descriptor.bindGroupEntries) throw new Error(`${material.name} has no descriptor for entries`)
        const entries: GPUBindGroupEntry[] = await Promise.all(material.descriptor.bindGroupEntries.map(async (entry) => {
            if (entry.sampler) {
                return {
                    binding: entry.bindingPoint,
                    resource: entry.sampler
                }
            } else if (entry?.textureDescriptor) {

                return {
                    binding: entry.bindingPoint,
                    resource: entry?.textureDescriptor.texture.createView(entry?.textureDescriptor.viewDescriptor),
                }
            } else if (entry.buffer) {

                return {
                    binding: entry.bindingPoint,
                    resource: {
                        buffer: entry.buffer
                    }
                }
            } else if (entry.additional?.typedArray) {

                let convertedData: GPUBuffer | GPUTexture;

                if (entry.additional?.typedArray.convertType === "buffer") {
                    convertedData = createGPUBuffer(BaseLayer.device, entry.additional?.typedArray.data, entry.additional?.typedArray.usage, entry.additional?.typedArray.label);
                } else if (entry.additional?.typedArray.convertType === "texture") {
                    convertedData = await GPUCache.textureGenerator.getGPUTexture(
                        entry.additional?.typedArray.data,
                        entry.additional?.typedArray.size,
                        entry.additional?.typedArray.format
                    );
                    GPUCache.visualTexturesCache.set(entry.additional.typedArray.hash!, convertedData)
                } else {
                    throw new Error(`Unknown conversionType`);
                }

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
            } else if (entry.additional?.textureArray) {
                let key = ``
                const hashes = Array.from(entry.additional.textureArray.textureMap);
                const size = entry.additional.textureArray.size
                hashes.forEach(([hash]) => {
                    key += hash;
                })
                key = key.split("").join("|")
                key += `@${size[0]}_${size[1]}`

                const cacheKey: ("globalTextureArrayCache" | "personalTextureArrayCache") = entry.additional?.textureArray.isGlobal ? "globalTextureArrayCache" : "personalTextureArrayCache";
                if (GPUCache[cacheKey].has(key)) {
                    return {
                        binding: entry.bindingPoint,
                        resource: GPUCache[cacheKey].get(key)!.createView({dimension: "2d-array"})
                    }
                }
                const texture = BaseLayer.device.createTexture({
                    size: [...size, hashes.length],
                    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT,
                    dimension: "2d",
                    format: "rgba8unorm"
                })
                for (let i = 0; i < hashes.length; i++) {
                    const decodedData = await GPUCache.textureGenerator.decodeToRGBA(BaseLayer.hasher.textureHashToData.get(hashes[i][0])!);
                    GPUCache.textureGenerator.copyDataIntoTextureLayers(texture, {
                        width: size[0],
                        height: size[1],
                    }, decodedData, {
                        x: 0, y: 0, z: i
                    })
                    GPUCache.textureLocationCache.set(hashes[i][0], {
                        width: size[0],
                        height: size[1],
                        layer: i,
                        isGlobal: entry.additional.textureArray.isGlobal,
                        textureArrayKey: key
                    })
                    BaseLayer.hasher.hashToRequests.get(hashes[i][0])?.forEach((_, material) => {
                        hashes[i][1].forEach(texture => {
                            material.shaderDescriptor.compileHints.push({
                                searchKeyword: `${texture}.textureIndex`,
                                replaceKeyword: `${i}`
                            })
                        })
                    })

                    BaseLayer.hasher.textureHashCache.delete(BaseLayer.hasher.textureHashToData.get(hashes[i][0])!)
                    BaseLayer.hasher.textureHashToData.delete(hashes[i][0])
                }
                GPUCache[cacheKey].set(key, texture)
                return {
                    resource: texture.createView({dimension: "2d-array"}),
                    binding: entry.bindingPoint
                }
            } else {
                throw new Error("in order to create bindGroup you need to specify an texture | sampler | typedArray | buffer")
            }
        }))
        return entries
    }

    static getEntriesNonAsync(material: MaterialInstance) {

        if (!material.descriptor.bindGroupEntries) throw new Error(`${material.name} has no descriptor for entries`)
        const entries: GPUBindGroupEntry[] = material.descriptor.bindGroupEntries.map((entry) => {
            if (entry.sampler) {
                return {
                    binding: entry.bindingPoint,
                    resource: entry.sampler
                }
            } else if (entry?.textureDescriptor) {

                return {
                    binding: entry.bindingPoint,
                    resource: entry?.textureDescriptor.texture.createView(entry?.textureDescriptor.viewDescriptor),
                }
            } else if (entry.buffer) {

                return {
                    binding: entry.bindingPoint,
                    resource: {
                        buffer: entry.buffer
                    }
                }
            } else if (entry.additional?.textureArray) {
                let key = ``
                const hashes = Array.from(entry.additional.textureArray.textureMap);
                const size = entry.additional.textureArray.size
                hashes.forEach(([hash]) => {
                    key += hash;
                })
                key = key.split("").join("|")
                key += `@${size[0]}_${size[1]}`
                const cacheKey: ("globalTextureArrayCache" | "personalTextureArrayCache") = entry.additional?.textureArray.isGlobal ? "globalTextureArrayCache" : "personalTextureArrayCache";
                return {
                    binding: entry.bindingPoint,
                    resource: GPUCache[cacheKey].get(key)!.createView({dimension: "2d-array"})
                }
            } else {
                throw new Error("in order to create bindGroup you need to specify an texture | sampler | typedArray | buffer")
            }
        })
        return entries
    }

    protected async createBindGroup(material: MaterialInstance) {
        const entries = await this.getEntries(material);
        return BaseLayer.device.createBindGroup({
            label: `bindGroup ${material.name}`,
            entries,
            layout: material.bindGroupLayout
        })
    }

    public async appendMaterialBindGroup(material: MaterialInstance,) {
        return await this.createBindGroup(material)
    }

    public getResource(hash: number | string, targetMap: "shaderModuleMap" | "pipelineMap" | "bindGroupLayoutMap" | "pipelineLayoutMap") {
        return GPUCache[targetMap].get(hash as never);
    }
}