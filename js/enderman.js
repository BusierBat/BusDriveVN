// js/enderman.js - ENDERMAN EASTER EGG
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

let endermanModel = null;
let activeEnderman = null;
let lastCheckTime = 0;

export function initEndermanEasterEgg() {
    const loader = new GLTFLoader();
    loader.load('assets/model/enderman.glb', (gltf) => {
        endermanModel = gltf.scene;
        
        // Tính bounding box để scale chuẩn
        const box = new THREE.Box3().setFromObject(endermanModel);
        const size = box.getSize(new THREE.Vector3());
        const targetHeight = 2.9; // Enderman cao ~2.9m
        const scale = targetHeight / size.y;
        endermanModel.scale.setScalar(scale);
        
        // Set material thân đen
        endermanModel.traverse((child) => {
            if (child.isMesh) {
                child.material = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 1.0 });
            }
        });
        
        // Thêm mắt trắng sáng (không cần raycast, dùng MeshBasicMaterial)
        const scaledBox = new THREE.Box3().setFromObject(endermanModel);
        const headY = scaledBox.max.y;
        const headZ = scaledBox.max.z;
        
        const eyeGeo = new THREE.SphereGeometry(0.08, 8, 8);
        const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
        const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
        leftEye.position.set(-0.15, headY - 0.35, headZ * 0.8);
        rightEye.position.set(0.15, headY - 0.35, headZ * 0.8);
        endermanModel.add(leftEye, rightEye);
        
        console.log('✅ Enderman model loaded for Easter Egg.');
    }, undefined, (error) => {
        console.warn('⚠️ Enderman model not found (assets/model/enderman.glb). Easter Egg disabled.');
    });
}

export function updateEnderman(scene, camera, lighting, playerPos, playerHeading, delta) {
    if (!endermanModel) return;
    
    const now = performance.now();
    if (now - lastCheckTime < 2000) return; // Check mỗi 2s
    lastCheckTime = now;
    
    const hour = lighting.getGameTime() / 60;
    const isNight = hour >= 18 || hour < 6;
    
    // Nếu ban ngày -> xóa Enderman nếu đang có
    if (!isNight) {
        if (activeEnderman) {
            scene.remove(activeEnderman);
            activeEnderman = null;
        }
        return;
    }
    
    // Nếu chưa có Enderman -> thử spawn
    if (!activeEnderman) {
        if (Math.random() < 0.001) { // 0.1% chance
            const angle = Math.random() * Math.PI * 2;
            const dist = 60 + Math.random() * 40; // 60-100m
            const spawnX = playerPos.x + Math.cos(angle) * dist;
            const spawnZ = playerPos.z + Math.sin(angle) * dist;
            
            // Không spawn trước đầu xe player
            const forwardX = Math.sin(playerHeading);
            const forwardZ = Math.cos(playerHeading);
            const dx = spawnX - playerPos.x;
            const dz = spawnZ - playerPos.z;
            const dot = dx * forwardX + dz * forwardZ;
            if (dot > 0) return; // Bỏ qua nếu phía trước
            
            activeEnderman = endermanModel.clone();
            activeEnderman.visible = true;
            activeEnderman.position.set(spawnX, 0, spawnZ);
            activeEnderman.lookAt(playerPos.x, activeEnderman.position.y, playerPos.z);
            scene.add(activeEnderman);
        }
    } else {
        // Nếu đã có -> check xem player có nhìn thẳng vào không
        const dirToEnderman = new THREE.Vector3();
        dirToEnderman.subVectors(activeEnderman.position, camera.position).normalize();
        const cameraDir = new THREE.Vector3();
        camera.getWorldDirection(cameraDir);
        const dot = dirToEnderman.dot(cameraDir);
        
        // Nếu player nhìn thẳng vào (góc hẹp) -> Teleport biến mất
        if (dot > 0.95) {
            scene.remove(activeEnderman);
            activeEnderman = null;
        }
    }
}