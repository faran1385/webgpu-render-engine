import {MaterialInstance} from "../../Material/Material.ts";
import {matTextureInfo, standardMaterialTextureInfo} from "../../Material/StandardMaterial.ts";

export class MaterialLayoutGenerator {

    setDescriptors(materials: MaterialInstance[]) {
        materials.forEach(material => {
            const textureArrays = new Map<string, Map<number, (keyof standardMaterialTextureInfo)[]>>()
            for (const key in material.textureInfo) {
                const item = (material.textureInfo as any)[key] as matTextureInfo;
                if (item.hash !== null && item.dimension) {
                    // shared
                    if (item.shareInfo) {
                        if (textureArrays.has(`SHARE${item.shareInfo.arrayIndex}@${item.dimension[0]}_${item.dimension[1]}`)) {
                            const map = textureArrays.get(
                                `SHARE${item.shareInfo.arrayIndex}@${item.dimension[0]}_${item.dimension[1]}`
                            )!
                            if (map.has(item.hash)) {
                                map.get(item.hash)?.push(key as any)
                            } else {
                                map.set(item.hash, [key as any])
                            }
                        } else {
                            textureArrays.set(
                                `SHARE${item.shareInfo.arrayIndex}@${item.dimension[0]}_${item.dimension[1]}`, new Map([[item.hash, [key as any]]]))
                        }
                    } else {
                        if (key !== "albedo") {
                            if (textureArrays.has(`PERSONAL@${item.dimension[0]}_${item.dimension[1]}`)) {
                                const map = textureArrays.get(
                                    `PERSONAL@${item.dimension[0]}_${item.dimension[1]}`
                                )!
                                if (map.has(item.hash)) {
                                    map.get(item.hash)?.push(key as any)
                                } else {
                                    map.set(item.hash, [key as any])
                                }
                            } else {
                                textureArrays.set(`PERSONAL@${item.dimension[0]}_${item.dimension[1]}`, new Map([[item.hash, [key as any]]]))
                            }
                        }
                    }
                }
            }

            textureArrays.forEach((textureMap, name) => {
                const wgslName = name.replace('@', "_");

                material.descriptor.bindGroupEntries.push({
                    bindingPoint: material.bindingCounter,
                    additional: {
                        textureArray: {
                            textureMap: textureMap,
                            size: name.split('@')[1].split("_").map(i => +i) as any
                        }
                    }
                })
                material.descriptor.layoutEntries.push({
                    binding: material.bindingCounter,
                    texture: {
                        sampleType: "float",
                        viewDimension: "2d-array"
                    },
                    visibility: GPUShaderStage.FRAGMENT
                })
                material.shaderDescriptor.bindings.push({
                    binding: material.bindingCounter,
                    group: 1,
                    wgslType: "texture_2d_array<f32>",
                    name: wgslName,
                    address: "var"
                })
                Array.from(textureMap).forEach(([_, keyArray]) => {
                    keyArray.forEach(key => {
                        material.shaderDescriptor.compileHints.push({
                            replaceKeyword: wgslName,
                            searchKeyword: `${key}.texture`
                        })
                    })
                })
                material.bindingCounter++
            })
        })
    }
}