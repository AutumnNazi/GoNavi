import type { ComponentProps } from 'react';
import BackgroundImageStyleHost from './BackgroundImageStyleHost';
import CustomThemeStyleHost from './CustomThemeStyleHost';
import ToolbarAppearanceStyleHost from './ToolbarAppearanceStyleHost';

export default function AppAppearanceStyleHosts(props: ComponentProps<typeof CustomThemeStyleHost>) {
  return (
    <>
      <CustomThemeStyleHost {...props} />
      <ToolbarAppearanceStyleHost />
      <BackgroundImageStyleHost />
    </>
  );
}
