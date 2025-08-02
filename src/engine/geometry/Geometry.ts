import {AttributeData, GeometryData, LODRange} from "../loader/loaderTypes.ts";
import {TypedArray} from "@gltf-transform/core";
import {generateID} from "../../helpers/global.helper.ts";

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
    hashes: { bindGroupLayout: number | null } = {bindGroupLayout: null};
    descriptors: Descriptors = {
        layout: null,
        bindGroup: null,
    }
    bindGroup!: GPUBindGroup

    constructor( geometryData: GeometryData) {
        this.id = generateID();
        this.dataList = geometryData.dataList;
        this.indices = geometryData.indices;
        this.indexType = geometryData.indexType ?? 'Unknown'
        this.indexCount = geometryData.indexCount;
        this.lodRanges = geometryData.lodRanges;
    }

    setBindGroupLayoutHash(layout: number) {
        this.hashes.bindGroupLayout = layout;
    }
}