import { useCallback, useEffect, useMemo, useState } from "react";
import { Image, View, type LayoutChangeEvent } from "react-native";
import { fitImageSize, type Size } from "./image-size";
import { IMAGE_INSET, type ViewerStyles } from "./styles";

export interface ImageViewProps {
  /** A data: URI. */
  uri: string;
  onError(): void;
  styles: ViewerStyles;
}

// Core shows images in a zoomable viewport; the plugin runtime has no gesture library, so this
// fits the image inside the pane without upscaling.
export function ImageView({ uri, onError, styles }: ImageViewProps) {
  const [bounds, setBounds] = useState<Size | null>(null);
  const natural = useNaturalSize(uri);

  const measure = useCallback((event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width - IMAGE_INSET * 2;
    const height = event.nativeEvent.layout.height - IMAGE_INSET * 2;
    // Hidden panes report zero; keep the last real measurement.
    if (width > 0 && height > 0) setBounds({ width, height });
  }, []);

  const displayed = useMemo(() => {
    if (!bounds) return null;
    return natural ? fitImageSize(natural, bounds) : bounds;
  }, [bounds, natural]);
  // Data URIs carry no intrinsic size on native, so width and height must be explicit.
  const source = useMemo(
    () => (displayed ? { uri, width: displayed.width, height: displayed.height } : null),
    [displayed, uri],
  );
  const imageStyle = useMemo(
    () => (displayed ? { width: displayed.width, height: displayed.height } : null),
    [displayed],
  );

  return (
    <View style={styles.imageFrame} onLayout={measure}>
      {source ? (
        <Image
          source={source}
          style={imageStyle}
          resizeMode="contain"
          onError={onError}
          accessibilityIgnoresInvertColors
        />
      ) : null}
    </View>
  );
}

/** The image's pixel size, or null until it is known or when it cannot be read. */
function useNaturalSize(uri: string): Size | null {
  const [natural, setNatural] = useState<{ uri: string; size: Size } | null>(null);
  useEffect(() => {
    let current = true;
    Image.getSize(
      uri,
      (width, height) => {
        if (current) setNatural({ uri, size: { width, height } });
      },
      () => {
        // Rendering still works without it; the image then fills the pane, contained.
      },
    );
    return () => {
      current = false;
    };
  }, [uri]);
  return natural?.uri === uri ? natural.size : null;
}
