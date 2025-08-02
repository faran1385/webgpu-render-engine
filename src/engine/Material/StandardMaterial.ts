import {Material as MaterialClass} from "./Material.ts";
import {extractMaterial} from "../../helpers/global.helper.ts";
import {
    StandardMaterialBindPoint,
    StandardMaterialFactorsStartPoint,
    RenderFlag
} from "../GPURenderSystem/MaterialDescriptorGenerator/MaterialDescriptorGeneratorTypes.ts";
import {Material} from "@gltf-transform/core";
import {
    MaterialDescriptorGenerator
} from "../GPURenderSystem/MaterialDescriptorGenerator/MaterialDescriptorGenerator.ts";
import {BaseLayer} from "../../layers/baseLayer.ts";

export class StandardMaterial extends MaterialClass {


    constructor(material: Material | null) {
        super();
        this.name = material?.getName() ?? "Default"
        if (material) {
            this.textureDataMap = extractMaterial(material)
            this.alpha = {
                mode: material.getAlphaMode(),
                cutoff: material.getAlphaCutoff()
            }
            this.isDoubleSided = material.getDoubleSided()
            this.isTransparent = material.getAlphaMode() === "BLEND"
        } else {
            this.textureDataMap.set(RenderFlag.BASE_COLOR, {
                texture: null,
                factor: [1, 1, 1, 1],
                factorStartPoint: StandardMaterialFactorsStartPoint.BASE_COLOR,
                bindPoint: StandardMaterialBindPoint.BASE_COLOR
            })
            const metallicRoughness = {
                texture: null,
                factor: [0, 0],
                factorStartPoint: StandardMaterialFactorsStartPoint.METALLIC,
                bindPoint: StandardMaterialBindPoint.METALLIC
            }
            this.textureDataMap.set(RenderFlag.METALLIC, metallicRoughness)
            this.textureDataMap.set(RenderFlag.ROUGHNESS, metallicRoughness)
            this.textureDataMap.set(RenderFlag.OCCLUSION, {
                texture: null,
                factor: 1,
                factorStartPoint: StandardMaterialFactorsStartPoint.OCCLUSION,
                bindPoint: StandardMaterialBindPoint.OCCLUSION
            })
            this.textureDataMap.set(RenderFlag.EMISSIVE, {
                texture: null,
                factor: [0, 0, 0],
                bindPoint: StandardMaterialBindPoint.EMISSIVE,
                factorStartPoint: StandardMaterialFactorsStartPoint.EMISSIVE
            })
        }
    }

    setBaseColorFactor(newValue: [number, number, number, number]) {
        const factors = this.resources.get(StandardMaterialBindPoint[StandardMaterialBindPoint.FACTORS]) as (GPUBuffer | undefined)
        if (!factors) throw new Error("factors does not exist on resources");


        BaseLayer.device.queue.writeBuffer(factors, StandardMaterialFactorsStartPoint.BASE_COLOR * 4, new Float32Array(newValue));
    }

    setMetallicFactor(newValue: number) {
        const factors = this.resources.get(StandardMaterialBindPoint[StandardMaterialBindPoint.FACTORS]) as (GPUBuffer | undefined)
        if (!factors) throw new Error("factors does not exist on resources");


        const singleFloat = new Float32Array([newValue]);

        BaseLayer.device.queue.writeBuffer(factors, StandardMaterialFactorsStartPoint.METALLIC * 4, singleFloat);
    }

    setRoughnessFactor(newValue: number) {
        const factors = this.resources.get(StandardMaterialBindPoint[StandardMaterialBindPoint.FACTORS]) as (GPUBuffer | undefined)
        if (!factors) throw new Error("factors does not exist on resources");


        const singleFloat = new Float32Array([newValue]);

        BaseLayer.device.queue.writeBuffer(factors, (StandardMaterialFactorsStartPoint.ROUGHNESS) * 4, singleFloat);
    }

    initDescriptor(materialBindGroupGenerator: MaterialDescriptorGenerator) {
        const {entries, hashEntries, layout, sampler} = materialBindGroupGenerator.getTechniqueBindGroup(this);
        this.descriptor = {
            entries,
            hashEntries,
            layout,
            sampler
        }
    }
}