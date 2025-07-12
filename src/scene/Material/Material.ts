import {Material as MaterialType, TypedArray, vec2} from "@gltf-transform/core";
import {extractMaterial, generateID} from "../../helpers/global.helper.ts";
import {
    PBRBindPoint,
    PBRFactorsStartPoint,
    RenderFlag
} from "../GPURenderSystem/MaterialDescriptorGenerator/MaterialDescriptorGeneratorTypes.ts";
import {BindGroupEntryCreationType} from "../GPURenderSystem/GPUCache/GPUCacheTypes.ts";
import {HashCreationBindGroupEntry} from "../GPURenderSystem/Hasher/HashGenerator.ts";
import {
    MaterialDescriptorGenerator
} from "../GPURenderSystem/MaterialDescriptorGenerator/MaterialDescriptorGenerator.ts";
import {BaseLayer} from "../../layers/baseLayer.ts";
import {Primitive} from "../primitive/Primitive.ts";
import {GPUCache} from "../GPURenderSystem/GPUCache/GPUCache.ts";

export type TextureData = {
    texture: {
        data: TypedArray,
        size: vec2
    } | null,
    factor: number | number[],
    pbrBindPoint: number,
    pbrFactorStartPoint: number
}

type Hashes = {
    bindGroupLayout: number | null,
    bindGroup: number | null
    sampler: number | null
    shader: number | null
}

export class Material extends BaseLayer {
    id: number;
    renderMethod: RenderFlag = RenderFlag.PBR
    samplerInfo: {
        descriptor: GPUSamplerDescriptor | null,
        bindPoint: number | null
        needsUpdate: boolean,
    } = {descriptor: null, needsUpdate: false, bindPoint: null}
    textureMap: Map<RenderFlag, TextureData> = new Map();
    descriptor!: {
        layout: GPUBindGroupLayoutEntry[],
        entries: BindGroupEntryCreationType[],
        hashEntries: HashCreationBindGroupEntry,
        needsUpdate: boolean
    };
    name!: string;
    alpha: {
        mode: "OPAQUE" | "MASK" | "BLEND",
        cutoff: number
    } = {mode: "OPAQUE", cutoff: 0}
    primitives: Set<Primitive> = new Set()
    hashes: Hashes = {
        bindGroup: null, bindGroupLayout: null, sampler: null, shader: null
    }
    resources: Map<string, GPUBuffer | GPUTexture | GPUSampler> = new Map();
    isDoubleSided: boolean = false
    shaderCode!: string

    constructor(device: GPUDevice, canvas: HTMLCanvasElement, ctx: GPUCanvasContext, material: MaterialType | null) {
        super(device, canvas, ctx);
        this.name = material?.getName() ?? "Material"
        this.id = generateID();
        if (material) {
            this.textureMap = extractMaterial(material)
            this.alpha = {
                mode: material.getAlphaMode(),
                cutoff: material.getAlphaCutoff()
            }
            this.isDoubleSided = material.getDoubleSided()
        } else {
            this.textureMap.set(RenderFlag.BASE_COLOR, {
                texture: null,
                factor: [1, 1, 1, 1],
                pbrFactorStartPoint: PBRFactorsStartPoint.BASE_COLOR,
                pbrBindPoint: PBRBindPoint.BASE_COLOR
            })
            const metallicRoughness = {
                texture: null,
                factor: [0, 0],
                pbrFactorStartPoint: PBRFactorsStartPoint.METALLIC_ROUGHNESS,
                pbrBindPoint: PBRBindPoint.METALLIC_ROUGHNESS
            }
            this.textureMap.set(RenderFlag.METALLIC, metallicRoughness)
            this.textureMap.set(RenderFlag.ROUGHNESS, metallicRoughness)
            this.textureMap.set(RenderFlag.OCCLUSION, {
                texture: null,
                factor: 1,
                pbrFactorStartPoint: PBRFactorsStartPoint.OCCLUSION,
                pbrBindPoint: PBRBindPoint.OCCLUSION
            })
            this.textureMap.set(RenderFlag.EMISSIVE, {
                texture: null,
                factor: [0, 0, 0],
                pbrBindPoint: PBRBindPoint.EMISSIVE,
                pbrFactorStartPoint: PBRFactorsStartPoint.EMISSIVE
            })
        }
    }

    setShaderCodeString(str: string) {
        this.shaderCode = str
    }

    async setDescriptor(layout: GPUBindGroupLayoutEntry[], entries: BindGroupEntryCreationType[], hashEntries: HashCreationBindGroupEntry, gpuCache: GPUCache) {
        this.descriptor = {
            layout,
            entries,
            hashEntries,
            needsUpdate: true
        }
        const oldLayout = this.hashes.bindGroupLayout;

        if (!oldLayout) throw new Error("material layout hash is not set")
        this.resources.forEach(resource => {
            if (resource instanceof GPUBuffer || resource instanceof GPUTexture) {
                resource.destroy()
            }
        })
        this.resources.clear()
        for (let primitive of this.primitives) {
            const geometry = primitive.geometry;
            if (!geometry.hashes.bindGroupLayout) throw new Error("geometry layout hash is not set")
            const primitivesArray = Array.from(this.primitives)
            primitive.bindGroups.delete(`${this.hashes.bindGroup}`)
            this.hashes.bindGroupLayout = GPUCache.hasher.hashBindGroupLayout(this.descriptor.layout)
            this.hashes.bindGroup = GPUCache.hasher.hashBindGroup(this.descriptor.hashEntries)
            const pipelineLayoutHash = GPUCache.hasher.hashPipelineLayout(this.hashes.bindGroupLayout, geometry.hashes.bindGroupLayout)
            gpuCache.appendBindGroupLayout(this.descriptor.layout, this.hashes.bindGroupLayout, primitive)
            await gpuCache.appendMaterialBindGroup(this, this.hashes.bindGroup!, this.hashes.bindGroupLayout, primitivesArray)
            gpuCache.appendPipelineLayout(pipelineLayoutHash, this.hashes.bindGroup!, geometry.hashes.bindGroupLayout, primitive)
            primitive.side.forEach(side => {
                const renderState = primitive.pipelineDescriptors.get(side)!
                const pipelineHash = GPUCache.hasher.hashPipeline(renderState, pipelineLayoutHash, primitive.vertexBufferDescriptors)
                const renderSetup = gpuCache.getRenderSetup(
                    pipelineHash,
                    pipelineLayoutHash,
                    this.hashes.bindGroup!,
                    geometry.hashes.bindGroupLayout!,
                    this.hashes.shader!
                )

                primitive.setPipeline(side!, renderSetup.pipeline)


                primitive.setBindGroup(renderSetup.materialBindGroup.label, {
                    bindGroup: renderSetup.materialBindGroup,
                    location: 1
                })
                primitive.setBindGroup(geometry.bindGroup.label, {bindGroup: geometry.bindGroup, location: 2})
                gpuCache.appendPipeline(renderState, pipelineHash, pipelineLayoutHash, this.hashes.shader!, primitive)
            })

        }

        Material._materialUpdateQueue.set(this.id, {
            material: this,
            oldLayout: oldLayout
        })
    }

    setHashes(key: keyof Hashes, value: number) {
        this.hashes[key] = value
    }

    addPrimitive(prim: Primitive) {
        if (!this.primitives.has(prim)) {
            this.primitives.add(prim)
        }
    }

    setRenderMethod(method: RenderFlag) {
        this.renderMethod = method;
    }


    initDescriptor(materialBindGroupGenerator: MaterialDescriptorGenerator) {
        if (this.renderMethod === RenderFlag.PBR) {
            const {entries, hashEntries, layout} = materialBindGroupGenerator.getTechniqueBindGroup(this);
            this.descriptor = {
                entries,
                hashEntries,
                layout,
                needsUpdate: false
            }

        } else {
            const {entries, hashEntries, layout} = materialBindGroupGenerator.getMaterialBindGroups(this);
            this.descriptor = {
                entries,
                hashEntries,
                layout,
                needsUpdate: false
            }
        }
    }
}