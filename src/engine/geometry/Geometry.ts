import {AttributeData, GeometryData, LODRange} from "../loader/loaderTypes.ts";
import {TypedArray} from "@gltf-transform/core";
import {generateID} from "../../helpers/global.helper.ts";
import {Hashes, ShaderDescriptor} from "../Material/Material.ts";

type Descriptors = {
    layout: GPUBindGroupLayoutEntry[] | null,
    bindGroup: (GPUBindGroupEntry & { name?: "model" | "normal", })[] | null
}

export class Geometry {
    id: number;
    dataList!: Map<string, AttributeData>;
    indices: TypedArray | undefined = undefined;
    indexType: 'uint16' | 'uint32' | 'Unknown';
    indexCount: number | undefined = undefined;
    lodRanges: LODRange[] | undefined = undefined
    hashes: Hashes = {
        bindGroupLayout: {old: null, new: null},
    }
    descriptors: Descriptors = {
        layout: null,
        bindGroup: null,
    }

    bindGroup!: GPUBindGroup
    shaderDescriptor: ShaderDescriptor = {
        bindings: [],
        compileHints: [],
        overrides: []
    }
    shaderCode: null | string = null



    constructor(geometryData: GeometryData) {
        this.id = generateID();
        this.dataList = geometryData.dataList;
        this.indices = geometryData.indices;
        this.indexType = geometryData.indexType ?? 'Unknown'
        this.indexCount = geometryData.indexCount;
        this.lodRanges = geometryData.lodRanges;
    }

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

}