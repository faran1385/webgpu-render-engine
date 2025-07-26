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
        size: vec2,
    } | null,
    factor: number | number[],
    pbrBindPoint: number,
    pbrFactorStartPoint: number
}

type Hashes = {
    bindGroupLayout: { old: number | null, new: number | null },
    bindGroup: { old: number | null, new: number | null }
    sampler: { old: number | null, new: number | null }
    shader: { old: number | null, new: number | null }
}

export class Material extends BaseLayer {
    id: number;
    renderMethod: RenderFlag = RenderFlag.BASE_COLOR
    samplerInfo: {
        descriptor: GPUSamplerDescriptor | null,
        bindPoint: number | null
    } = {descriptor: null, bindPoint: null}
    textureMap: Map<RenderFlag, TextureData> = new Map();
    descriptor: {
        layout: GPUBindGroupLayoutEntry[] | null,
        entries: BindGroupEntryCreationType[] | null,
        hashEntries: HashCreationBindGroupEntry | null,
    } = {layout: null, entries: null, hashEntries: null}
    name!: string;
    alpha: {
        mode: "OPAQUE" | "MASK" | "BLEND",
        cutoff: number
    } = {mode: "OPAQUE", cutoff: 0}
    primitives: Set<Primitive> = new Set()
    hashes: Hashes = {
        bindGroup: {old: null, new: null},
        bindGroupLayout: {old: null, new: null},
        sampler: {old: null, new: null},
        shader: {old: null, new: null}
    }
    bindGroup!: GPUBindGroup
    resources: Map<string, GPUBuffer | GPUTexture | GPUSampler> = new Map();
    isDoubleSided: boolean = false
    shaderCode: string | null = null
    updateStates = {
        descriptor: false,
        shader: false
    }


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

    setBindGroup(bindGroup: GPUBindGroup) {
        this.bindGroup = bindGroup;
    }

    setShaderCodeString(str: string) {
        this.shaderCode = str
    }


    setBaseColorFactor(newValue:[number,number,number,number]) {
        const factors = this.resources.get('Factors') as (GPUBuffer | undefined)
        if (!factors) throw new Error("factors does not exist on resources");



        BaseLayer.device.queue.writeBuffer(factors, PBRFactorsStartPoint.BASE_COLOR * 4, new Float32Array(newValue));
    }

    setMetallicFactor(newValue: number) {
        const factors = this.resources.get('Factors') as (GPUBuffer | undefined)
        if (!factors) throw new Error("factors does not exist on resources");


        const singleFloat = new Float32Array([newValue]);

        BaseLayer.device.queue.writeBuffer(factors, PBRFactorsStartPoint.METALLIC_ROUGHNESS * 4, singleFloat);
    }

    setRoughnessFactor(newValue: number) {
        const factors = this.resources.get('Factors') as (GPUBuffer | undefined)
        if (!factors) throw new Error("factors does not exist on resources");


        const singleFloat = new Float32Array([newValue]);

        BaseLayer.device.queue.writeBuffer(factors, (PBRFactorsStartPoint.METALLIC_ROUGHNESS + 1) * 4, singleFloat);
    }

    setHashes(key: keyof Hashes, value: number) {
        const oldVal = this.hashes[key].new;

        if (value !== oldVal) {
            this.hashes[key] = {
                new: value,
                old: oldVal
            }
        }
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
            }

        } else {
            const {entries, hashEntries, layout} = materialBindGroupGenerator.getMaterialBindGroups(this);
            this.descriptor = {
                entries,
                hashEntries,
                layout,
            }
        }
    }
}