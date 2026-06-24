import * as React from '@theia/core/shared/react'
import { ThemeService } from '@theia/core/lib/browser/theming'
import { getThemeMode } from '@theia/core/lib/common/theme'
import { ConfigProvider, theme as antdTheme } from 'antd'

export interface AntdThemeProviderProps {
  themeService: ThemeService
  children: React.ReactNode
}

export function AntdThemeProvider({
  themeService,
  children,
}: AntdThemeProviderProps): JSX.Element {
  const [mode, setMode] = React.useState<'light' | 'dark'>(() =>
    getThemeMode(themeService.getCurrentTheme().type),
  )

  React.useEffect(() => {
    const disposable = themeService.onDidColorThemeChange((event) => {
      setMode(getThemeMode(event.newTheme.type))
    })
    return () => disposable.dispose()
  }, [themeService])

  const algorithm =
    mode === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm

  return (
    <ConfigProvider
      theme={{
        algorithm,
        token: {
          colorPrimary: 'var(--theia-accent-color)',
          colorText: 'var(--theia-ui-font-color1)',
          colorTextSecondary: 'var(--theia-ui-font-color2)',
          colorBorder: 'var(--theia-ui-border)',
          colorBgBase: 'var(--theia-editorWidget-background)',
          colorBgContainer: 'var(--theia-editorWidget-background)',
          colorBgElevated: 'var(--theia-editorWidget-background)',
        },
      }}
    >
      {children}
    </ConfigProvider>
  )
}
