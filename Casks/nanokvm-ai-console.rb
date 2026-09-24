cask "nanokvm-ai-console" do
  arch arm: "arm64", intel: "x64"

  version "1.0.1"
  sha256 arm:   "6cd9349b98b0e7699fca8df508749c7c5c2deae204cc36b5a7d60a3404ee329b",
         intel: "963a127eacf9936153c3770b125ee2e89e00a3edf4787cddd244318edb14d967"

  url "https://github.com/blue1st/nanokvm-ai-console/releases/download/v#{version}/NanoKVM-AI-Console-#{version}-mac-#{arch}.dmg"
  name "NanoKVM AI Console"
  desc "Desktop AI Console for NanoKVM Remote MCP and llama.cpp server"
  homepage "https://github.com/blue1st/nanokvm-ai-console"

  livecheck do
    url :url
    strategy :github_latest
  end

  app "NanoKVM AI Console.app"

  postflight do
    system_command "/usr/bin/xattr",
                   args: ["-cr", "#{appdir}/NanoKVM AI Console.app"],
                   sudo: false
  end

  zap trash: [
    "~/Library/Application Support/nanokvm-ai-console",
    "~/Library/Preferences/com.nanokvm.aiconsole.plist",
    "~/Library/Saved Application State/com.nanokvm.aiconsole.savedState",
  ]
end
