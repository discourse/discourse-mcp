using System.Diagnostics;

var exePath = Environment.ProcessPath ?? string.Empty;
var exeName = Path.GetFileNameWithoutExtension(exePath).ToLowerInvariant();
var mode = exeName.Contains("login", StringComparison.OrdinalIgnoreCase) ? "login" : "start";
var root = FindRepositoryRoot(AppContext.BaseDirectory);
var scriptName = mode == "login" ? "shuiyuan-login.js" : "shuiyuan-mcp.js";
var scriptPath = Path.Combine(root, "dist", scriptName);

if (!File.Exists(scriptPath))
{
    Console.Error.WriteLine($"Missing {scriptPath}. Run corepack pnpm build before using this launcher.");
    return 1;
}

var startInfo = new ProcessStartInfo("node")
{
    UseShellExecute = false,
    WorkingDirectory = root,
};

startInfo.ArgumentList.Add(scriptPath);
foreach (var arg in args)
{
    startInfo.ArgumentList.Add(arg);
}

using var child = Process.Start(startInfo);
if (child is null)
{
    Console.Error.WriteLine("Failed to start node.");
    return 1;
}

child.WaitForExit();
return child.ExitCode;

static string FindRepositoryRoot(string startDirectory)
{
    var dir = new DirectoryInfo(startDirectory);
    while (dir is not null)
    {
        if (File.Exists(Path.Combine(dir.FullName, "dist", "shuiyuan-mcp.js")))
        {
            return dir.FullName;
        }
        dir = dir.Parent;
    }

    throw new InvalidOperationException("Could not find repository root containing dist\\shuiyuan-mcp.js.");
}
