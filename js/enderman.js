// js/enderman.js
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

let endermanModel = null, activeEnderman = null, lastCheckTime = 0;

export function initEndermanEasterEgg() {
    const loader = new GLTFLoader();
    loader.load('assets/model/enderman.glb', (gltf) => {
        endermanModel = gltf.scene;
        const box = new THREE.Box3().setFromObject(endermanModel);
        const targetHeight = 2.9, scale = targetHeight / box.getSize(new THREE.Vector3()).y;
        endermanModel.scale.setScalar(scale);
        endermanModel.traverse((child) => { if (child.isMesh) child.material = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 1.0 }); });
        const headY = new THREE.Box3().setFromObject(endermanModel).max.y, headZ = new THREE.Box3().setFromObject(endermanModel).max.z;
        const eyeGeo = new THREE.SphereGeometry(0.08, 8, 8), eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        const lE = new THREE.Mesh(eyeGeo, eyeMat), rE = new THREE.Mesh(eyeGeo, eyeMat);
        lE.position.set(-0.15, headY - 0.35, headZ * 0.8); rE.position.set(0.15, headY - 0.35, headZ * 0.8);
        endermanModel.add(lE, rE);
    }, undefined, () => {});
}

export function updateEnderman(scene, camera, lighting, playerPos, playerHeading, delta) {
    if (!endermanModel) return;
    const now = performance.now(); if (now - lastCheckTime < 2000) return; lastCheckTime = now;
    const hour = lighting.getGameTime() / 60, isNight = hour >= 18 || hour < 6;
    if (!isNight) { if (activeEnderman) { scene.remove(activeEnderman); activeEnderman = null; } return; }
    if (!activeEnderman) {
        if (Math.random() < 0.001) {
            const angle = Math.random() * Math.PI * 2, dist = 60 + Math.random() * 40;
            const x = playerPos.x + Math.cos(angle) * dist, z = playerPos.z + Math.sin(angle) * dist;
            if (Math.sin(playerHeading) * (x - playerPos.x) + Math.cos(playerHeading) * (z - playerPos.z) > 0) return;
            activeEnderman = endermanModel.clone(); activeEnderman.visible = true;
            activeEnderman.position.set(x, 0, z); activeEnderman.lookAt(playerPos.x, 0, playerPos.z);
            scene.add(activeEnderman);
        }
    } else {
        const dir = new THREE.Vector3().subVectors(activeEnderman.position, camera.position).normalize();
        if (dir.dot(camera.getWorldDirection(new THREE.Vector3())) > 0.95) { scene.remove(activeEnderman); activeEnderman = null; }
    }
}
