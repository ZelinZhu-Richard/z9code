import type { ColorValue } from "react-native";
import Svg, { Path } from "react-native-svg";
import { withUniwind } from "uniwind";

const ThemedPath = withUniwind(Path);

export function Z9Wordmark(props: {
  readonly height: number;
  readonly color?: ColorValue;
  readonly colorClassName?: string;
}) {
  const aspectRatio = 94.3941 / 56.96;
  return (
    <Svg
      accessibilityLabel="z9code"
      height={props.height}
      width={props.height * aspectRatio}
      viewBox="15 37 96.5 56"
    >
      <ThemedPath
        d="M15 37H62V48L30.5 82H62V93H15V82L46.5 48H15Z M90 37A21.5 21.5 0 1 1 90 80A21.5 21.5 0 1 1 90 37Z M90 48A10.5 10.5 0 1 0 90 69A10.5 10.5 0 1 0 90 48Z M100.5 58.5H111.5V93H100.5Z"
        fillRule="evenodd"
        color={props.color}
        colorClassName={props.colorClassName}
        fill="currentColor"
      />
    </Svg>
  );
}
