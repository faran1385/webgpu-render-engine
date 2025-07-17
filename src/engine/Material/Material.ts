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
    descriptor: {
        layout: GPUBindGroupLayoutEntry[] | null,
        entries: BindGroupEntryCreationType[] | null,
        hashEntries: HashCreationBindGroupEntry | null,
        needsUpdate: boolean
    } = {layout: null, entries: null, hashEntries: null, needsUpdate: false}
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
    shaderCode: string | null = null

    constructor(device: GPUDevice, canvas: HTMLCanvasElement, ctx: GPUCanvasContext, material: MaterialType | null) {
        super(device, canvas, ctx);
        this.name = material?.getName() ?? "Default"
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

    async setDescriptor(layout: GPUBindGroupLayoutEntry[], entries: BindGroupEntryCreationType[], hashEntries: HashCreationBindGroupEntry) {
        this.descriptor = {
            layout,
            entries,
            hashEntries,
            needsUpdate: true
        }
        console.log(this.descriptor)
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