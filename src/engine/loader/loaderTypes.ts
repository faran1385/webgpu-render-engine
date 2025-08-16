import {TypedArray} from "@gltf-transform/core";


export type LODRange = { start: number; count: number, };
export type AttributeData = { array: TypedArray; itemSize: number };


export type GeometryData = {
    dataList: Map<string, AttributeData>;
    indices?: TypedArray;
    indexType?: 'uint16' | 'uint32' | 'Unknown';
    indexCount?: number;
    lodRanges?: LODRange[]
};
