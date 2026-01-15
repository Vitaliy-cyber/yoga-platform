import { useState, useCallback } from 'react';
import type { LayerType } from '../types';

export function useLayers(initialLayer: LayerType = 'photo') {
  const [activeLayer, setActiveLayer] = useState<LayerType>(initialLayer);

  const selectLayer = useCallback((layer: LayerType) => {
    setActiveLayer(layer);
  }, []);

  const nextLayer = useCallback(() => {
    const layers: LayerType[] = ['photo', 'muscles'];
    const currentIndex = layers.indexOf(activeLayer);
    const nextIndex = (currentIndex + 1) % layers.length;
    setActiveLayer(layers[nextIndex]);
  }, [activeLayer]);

  const prevLayer = useCallback(() => {
    const layers: LayerType[] = ['photo', 'muscles'];
    const currentIndex = layers.indexOf(activeLayer);
    const prevIndex = (currentIndex - 1 + layers.length) % layers.length;
    setActiveLayer(layers[prevIndex]);
  }, [activeLayer]);

  return {
    activeLayer,
    selectLayer,
    nextLayer,
    prevLayer,
  };
}
