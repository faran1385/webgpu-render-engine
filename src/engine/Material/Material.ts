import {TypedArray, vec2} from "@gltf-transform/core";
import {
    RenderFlag
} from "../GPURenderSystem/MaterialDescriptorGenerator/MaterialDescriptorGeneratorTypes.ts";
import {BindGroupEntryCreationType} from "../GPURenderSystem/GPUCache/GPUCacheTypes.ts";
import {HashCreationBindGroupEntry} from "../GPURenderSystem/Hasher/HashGenerator.ts";
import {Primitive} from "../primitive/Primitive.ts";
import {StandardMaterial} from "./StandardMaterial.ts";

export type TextureData = {
    texture: {
        data: TypedArray,
        size: vec2,
    } | null,
    factor: number | number[],
    bindPoint: number,
    factorStartPoint: number
}

type Hashes = {
    bindGroupLayout: { old: number | null, new: number | null },
    bindGroup: { old: number | null, new: number | null }
    sampler: { old: number | null, new: number | null }
    shader: { old: number | null, new: number | null }
}

export type MaterialInstance = StandardMaterial;


export class Material {
    initialized = false
    textureDataMap: Map<RenderFlag, TextureData> = new Map();
    descriptor: {
        layout: GPUBindGroupLayoutEntry[] | null,
        entries: BindGroupEntryCreationType[] | null,
        hashEntries: HashCreationBindGroupEntry | null,
        sampler: GPUSamplerDescriptor | null,
    } = {layout: null, entries: null, hashEntries: null, sampler: null}
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
    isTransparent: boolean = false;



    setHashes(key: keyof Hashes, value: number | null) {
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
}