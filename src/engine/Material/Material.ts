import {Primitive} from "../primitive/Primitive.ts";
import {StandardMaterial} from "./StandardMaterial.ts";


export type Hashes = {
    bindGroupLayout: { old: number | null, new: number | null },
}

export type MaterialInstance = StandardMaterial;
export type bindingType = {
    group: number,
    binding: number,
    address: string,
    name: string,
    wgslType: string,
}
export type compileHintType = {
    searchKeyword: string,
    replaceKeyword: string,
}

export interface ShaderDescriptor {
    bindings: bindingType[]
    compileHints: compileHintType[]
    overrides: Record<string, any>
}

export class Material {
    initialized = false
    name!: string;
    alpha: {
        mode: "OPAQUE" | "MASK" | "BLEND",
        cutoff: number
    } = {mode: "OPAQUE", cutoff: 0}
    primitives: Set<Primitive> = new Set()
    hashes: Hashes = {
        bindGroupLayout: {old: null, new: null},
    }
    bindGroup!: GPUBindGroup;
    bindGroupLayout!: GPUBindGroupLayout;
    isDoubleSided: boolean = false
    shaderCode: string | null = null
    isTransparent: boolean = false;
    shaderDescriptor: ShaderDescriptor = {
        bindings: [],
        compileHints: [],
        overrides: []
    }
    bindingCounter = 0;

    compileShader() {
        if (!this.shaderCode) throw new Error("There is no shader code set on material");
        this.shaderDescriptor.compileHints.forEach(hint => {
            this.shaderCode = (this.shaderCode as any).replaceAll(`[[${hint.searchKeyword}]]`, hint.replaceKeyword)
        })
    }

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