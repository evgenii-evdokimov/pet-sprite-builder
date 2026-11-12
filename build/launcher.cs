using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Windows.Forms;

static class Program
{
    [STAThread]
    static void Main(string[] args)
    {
        string baseDir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
        string core = Path.Combine(baseDir, "PetSpriteBuilderCore.exe");

        if (!File.Exists(core))
        {
            MessageBox.Show(
                "Не найден файл ядра приложения:\n\n" + core,
                "Pet Sprite Builder",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error
            );
            return;
        }

        string extra = args.Length > 0 ? " " + string.Join(" ", args) : "";
        string arguments = "--no-sandbox" + extra;

        try
        {
            ProcessStartInfo psi = new ProcessStartInfo(core, arguments);
            psi.UseShellExecute = false;
            psi.WorkingDirectory = baseDir;
            Process.Start(psi);
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                "Не удалось запустить приложение.\n\n" + core + "\n\n" + ex.Message,
                "Pet Sprite Builder",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error
            );
        }
    }
}
