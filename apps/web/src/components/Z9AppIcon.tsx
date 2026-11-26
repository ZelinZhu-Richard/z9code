// The production icon, as GitHub shows the z9code app, whatever this build's channel.
import appIconUrl from "../../../../assets/prod/z9code-black-web-apple-touch-180.png";

export function Z9AppIcon(props: { readonly className?: string }) {
  return <img src={appIconUrl} alt="" className={props.className} />;
}
